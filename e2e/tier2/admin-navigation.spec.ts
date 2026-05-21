import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-86 — Tier 2 navigation smoke untuk AdminShell sections.
 *
 * Validate semua section critical render tanpa crash. Catch regression
 * di routing / hash-based section switching + ensure no module
 * broken by recent refactor.
 *
 * Sections tested (sebagian kecil; semua section render lazy-loaded
 * via dynamic import, jadi navigate ke section = trigger lazy chunk
 * load + render):
 *   - inventory
 *   - finance
 *   - accounting
 *   - shifts
 *   - cash (Setoran Tunai)
 *   - reports
 */

const SECTIONS = [
  { hash: "inventory", label: /inventory|inventaris|stock/i },
  { hash: "finance", label: /finance|keuangan|setoran|cash deposit/i },
  { hash: "accounting", label: /accounting|akuntansi|jurnal|neraca/i },
  { hash: "shifts", label: /shift|kasir/i },
  { hash: "cash", label: /cash|kas/i },
  { hash: "reports", label: /report|laporan/i },
];

test.describe("AdminShell navigation smoke", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard");
  });

  for (const { hash, label } of SECTIONS) {
    test(`Section /dashboard#${hash} render tanpa crash`, async ({ page }) => {
      await page.goto(`/dashboard#${hash}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2_000);

      const bodyText = await page.locator("body").innerText();
      /* Verify section content render (cari keyword sesuai section). */
      expect(bodyText, `Section ${hash} harus render konten relevan`).toMatch(
        label,
      );
      /* No error boundary. */
      expect(bodyText).not.toMatch(
        /something went wrong|client-side exception|application error/i,
      );
    });
  }
});
