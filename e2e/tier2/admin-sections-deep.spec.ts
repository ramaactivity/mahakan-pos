import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-90 — Broader admin section coverage.
 *
 * Builds on admin-navigation.spec.ts (6 sections) — add 8 more
 * sections yang belum covered, each verify:
 *   - Section render dengan content sesuai topik
 *   - No React error boundary fallback
 *   - Tidak crash di hash-based section switching
 *
 * Sections covered di sini (yang belum di admin-navigation.spec.ts):
 *   - staff (User management)
 *   - suppliers
 *   - purchase_requests
 *   - employees (Karyawan)
 *   - hr_operations
 *   - promos
 *   - balance_account (Saldo Akun)
 *   - reconciliation
 *   - aggregator_online (Online & Cashless)
 *   - audit
 */

const SECTIONS = [
  { hash: "staff", label: /user|staff|owner|manager|role/i },
  { hash: "suppliers", label: /supplier/i },
  { hash: "purchase_requests", label: /permintaan|purchase|belanja|request/i },
  { hash: "employees", label: /karyawan|employee/i },
  { hash: "hr_operations", label: /hr|attendance|absensi|jadwal|payroll/i },
  { hash: "promos", label: /promo|kampanye/i },
  { hash: "balance_account", label: /saldo|account|akun|bank|kas/i },
  { hash: "reconciliation", label: /rekonsiliasi|reconcile|cocok/i },
  { hash: "aggregator_online", label: /aggregator|online|gofood|grabfood|shopee/i },
  { hash: "audit", label: /audit|log|aktivitas|event/i },
];

test.describe("Admin sections broader coverage", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard");
  });

  for (const { hash, label } of SECTIONS) {
    test(`Section /dashboard#${hash} render konten relevan`, async ({ page }) => {
      await page.goto(`/dashboard#${hash}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2_000);

      const bodyText = await page.locator("body").innerText();
      expect(bodyText, `Section ${hash} harus render konten relevan`).toMatch(
        label,
      );
      expect(bodyText).not.toMatch(
        /something went wrong|client-side exception|application error/i,
      );
    });
  }
});
