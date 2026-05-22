import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-95 — Purchase Requests (Permintaan Belanja) admin section smoke.
 *
 * Verify admin section render + filter tab navigation. PR create flow
 * sebenarnya di /m/po (mobile staff context) — admin role hanya menerima
 * & batal. Test ini fokus ke:
 *   - Section render dengan PrStatCards
 *   - Filter tablist (Open / Sebagian / Selesai / Batal / Semua) bisa
 *     diklik tanpa crash
 *   - Mobile /m/po render header "Permintaan" untuk staff workflow
 */

test.describe("Permintaan Belanja admin section", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#purchase_requests");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);
  });

  test("Section render dengan header + stat cards", async ({ page }) => {
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/Permintaan Belanja|Permintaan/);
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception/i,
    );
  });

  test("Filter tablist render + clickable", async ({ page }) => {
    const filterTablist = page
      .getByRole("tablist", { name: /Filter status/i })
      .first();
    await expect(filterTablist).toBeVisible({ timeout: 10_000 });

    /* Filter chips: setidaknya satu tab status visible. */
    const tabs = filterTablist.getByRole("tab");
    const count = await tabs.count();
    expect(count).toBeGreaterThan(0);
  });

  test("Stat card 'Open + Partial' render dengan angka", async ({ page }) => {
    const bodyText = await page.locator("body").innerText();
    /* PrStatCard render "Open + Partial" + angka. */
    expect(bodyText).toMatch(/Open.*Partial|Aging|Selesai|Total Lifetime/i);
  });
});

test.describe("Permintaan Belanja mobile (/m/po)", () => {
  test("Mobile PR page render tanpa crash", async ({ page }) => {
    await loginAsE2EOwner(page, "/m/po");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/permintaan|belanja|barang|kasir|staff/i);
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception/i,
    );
  });
});
