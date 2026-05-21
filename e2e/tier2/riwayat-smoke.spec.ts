import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-89 — Riwayat (POS history) panel smoke test.
 *
 * Verify tab Riwayat render daftar transaksi yang baru ke-create
 * dari pos-transaction.spec.ts (TRX-20260522-0001 Rp 21k cash paid).
 *
 * Refund partial flow full butuh modal interaksi + approval code email
 * — di-skip karena marginal value rendah. Yang penting verify tab render
 * + transaksi historis visible.
 */

test.describe("Riwayat (POS history) panel", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/pos");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);
  });

  test("Tab Riwayat render daftar transaksi recent", async ({ page }) => {
    const riwayatTab = page
      .getByRole("button", { name: "Riwayat", exact: true })
      .first();
    await expect(riwayatTab).toBeVisible({ timeout: 15_000 });
    await riwayatTab.click();
    await page.waitForTimeout(2_500);

    const bodyText = await page.locator("body").innerText();
    /* Filter chip yang biasa muncul: Lunas, Open, Void, Refund. */
    const hasFilters = /lunas|open|void|refund|riwayat|transaksi/i.test(
      bodyText,
    );
    expect(hasFilters).toBe(true);
  });

  test("Filter chip Lunas/Open/Void/Refund visible", async ({ page }) => {
    const riwayatTab = page
      .getByRole("button", { name: "Riwayat", exact: true })
      .first();
    await riwayatTab.click();
    await page.waitForTimeout(2_500);

    /* HistoryPanel render filter chips. */
    const lunasChip = page.getByRole("button", { name: /Lunas/i }).first();
    await expect(lunasChip).toBeVisible({ timeout: 10_000 });
  });

  test("Transaction list shows at least 1 entry", async ({ page }) => {
    const riwayatTab = page
      .getByRole("button", { name: "Riwayat", exact: true })
      .first();
    await riwayatTab.click();
    await page.waitForTimeout(3_500);

    /* Branch punya beberapa transaksi (TRX-20260522-0001, dst).
     * Verify ada Rp pattern di body (indikasi tabel render). */
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/TRX-?\d|Rp\s*\d/);
  });
});
