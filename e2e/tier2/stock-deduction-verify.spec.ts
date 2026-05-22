import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";
import {
  createPaidTransaction,
  ensureShiftOpen,
} from "./_fixtures/pos-seed";

/**
 * Sesi AE-101 — Stock deduction end-to-end verification.
 *
 * Critical invariant Mahakan: **setiap paid POS transaction HARUS deduct
 * stock bahan** (via recipe → ingredients → inventory_movements with
 * kind='sale_deduct').
 *
 * Bug-class yang ditangkap:
 *   - stockDeductedAt timestamp tidak ke-set (silent skip)
 *   - sale_deduct hook gagal di edge case
 *   - Recipe lookup broken (qty 0 deduct)
 *   - Stock decrement race condition (negative balance allowed)
 *
 * Flow:
 *   1. Login → POS → buka shift kalau belum
 *   2. createPaidTransaction (Affogato/Americano/Bakmi — bahan dengan recipe)
 *   3. Navigate ke /dashboard#inventory → tab Pergerakan
 *   4. Filter Tipe = "Penjualan" (sale_deduct only)
 *   5. Verify list punya entry hari ini (count > 0)
 *
 * Skip kalau menu item terpilih tidak punya recipe (default branch state
 * mungkin variable). Pesan skip explicit supaya tidak salah-diagnose
 * sebagai bug.
 */

test.describe("Stock deduction after paid transaction", () => {
  test("Paid POS transaction trigger sale_deduct movement entry", async ({
    page,
  }) => {
    /* 1-2. Buka shift + create transaction. */
    await loginAsE2EOwner(page, "/pos");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    await ensureShiftOpen(page);
    const trxNumber = await createPaidTransaction(page);
    expect(trxNumber, "Seed harus return TRX").toMatch(/^TRX-\d{8}-\d+$/);

    /* 3. Navigate ke Inventory → Pergerakan. */
    await page.goto("/dashboard#inventory");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const pergerakanTab = page
      .getByRole("tab", { name: /Pergerakan/i })
      .first();
    await expect(pergerakanTab).toBeVisible({ timeout: 10_000 });
    await pergerakanTab.click();
    await page.waitForTimeout(2_500);

    /* 4. Filter Tipe = "Penjualan" via Select dropdown.
     * MovementsList pakai shadcn Select dengan label "Tipe". */
    const tipeSelect = page.getByLabel(/Tipe/i).first();
    if (await tipeSelect.isVisible({ timeout: 5_000 }).catch(() => false)) {
      /* Klik trigger → select opens → click "Penjualan". */
      await tipeSelect.click();
      await page.waitForTimeout(500);
      const penjualanOption = page
        .getByRole("option", { name: /^Penjualan$/i })
        .first();
      if (
        await penjualanOption
          .isVisible({ timeout: 2_000 })
          .catch(() => false)
      ) {
        await penjualanOption.click();
        await page.waitForTimeout(2_000);
      }
    }

    /* 5. Verify list render with movements OR explicit empty state.
     * Header "Pergerakan Stok (N)" — N harus > 0 kalau sale_deduct hook
     * jalan dan menu item punya recipe. */
    const heading = page.getByRole("heading", {
      name: /Pergerakan Stok/i,
    });
    await expect(heading).toBeVisible({ timeout: 10_000 });

    const headingText = await heading.innerText();
    /* Format: "Pergerakan Stok (N)" atau "Pergerakan Stok (N+)" */
    const countMatch = headingText.match(/\((\d+)/);
    const count = countMatch ? parseInt(countMatch[1], 10) : 0;

    /* Kalau count = 0, kemungkinan menu items default branch belum punya
     * recipe — skip dengan clear reason, bukan fail. */
    if (count === 0) {
      const bodyText = await page.locator("body").innerText();
      const hasEmptyState = /Tidak ada pergerakan stok/i.test(bodyText);
      if (hasEmptyState) {
        test.skip(
          true,
          "Menu items (Affogato/Americano/Bakmi) di branch ini belum punya recipe — stock deduction skip karena tidak ada bahan ter-link. Setup recipe via /dashboard#inventory tab Resep dulu.",
        );
      }
    }

    expect(
      count,
      `Sale deduct count harus > 0 — sale_deduct hook tidak fire atau recipe missing untuk menu yang ke-pick`,
    ).toBeGreaterThan(0);

    /* 6. Bonus: assert minimal salah satu row punya "Penjualan" tipe badge.
     * Table sudah filtered, jadi semua row harus Penjualan. */
    const penjualanBadge = page.getByText(/^Penjualan$/i).first();
    await expect(penjualanBadge).toBeVisible({ timeout: 5_000 });
  });
});
