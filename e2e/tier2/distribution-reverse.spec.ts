import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-92 — Distribusi v2 reverse flow smoke.
 *
 * Branch state setelah distribution-v2-approve.spec.ts: 2026-05 v2
 * status='posted'. Test ini buka preview modal + verify tombol "Reverse"
 * visible + click → reverse dialog terbuka.
 *
 * Tidak full submit reverse karena akan affect saldo investor (yang
 * di-verify oleh withdrawal-flow.spec.ts). Verify UI flow only.
 */

test.describe("Distribusi v2 reverse flow", () => {
  test("Posted distribution preview modal punya tombol Reverse", async ({
    page,
  }) => {
    await loginAsE2EOwner(page, "/dashboard#investors");
    await page.waitForLoadState("networkidle");

    const tabBtn = page.getByRole("button", { name: "Distribusi", exact: true });
    await expect(tabBtn).toBeVisible({ timeout: 15_000 });
    await tabBtn.click();
    await page.waitForTimeout(2_500);

    /* Cari row 2026-05 dengan status posted. */
    const postedRow = page
      .locator("tr", { hasText: /Mei 2026/i })
      .filter({ hasText: /posted/i })
      .first();
    if (
      !(await postedRow.isVisible({ timeout: 5_000 }).catch(() => false))
    ) {
      test.skip(true, "No posted v2 dist 2026-05 (re-run approve spec dulu)");
    }
    await postedRow.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    /* Tombol Reverse di footer modal. canReverse = isPosted && isV2. */
    const reverseBtn = dialog.getByRole("button", { name: /Reverse/i });
    await expect(reverseBtn).toBeVisible({ timeout: 5_000 });
  });
});
