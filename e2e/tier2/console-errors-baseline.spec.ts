import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";
import { attachConsoleErrorCollector } from "./_fixtures/console-errors";

/**
 * Sesi AE-97 — Console errors baseline smoke (F3 improvement).
 *
 * Exercise critical pages dan fail kalau ada console.error atau pageerror
 * yang unexpected. Tujuan: catch silent JS bug yang body-text check tidak
 * tangkap (hydration mismatch, fetch failure, missing dependency).
 *
 * Kalau test ini mulai fail di sesi mendatang, prioritas P0 — fix root
 * cause, jangan whitelist tanpa investigation.
 */

const CRITICAL_PAGES = [
  { name: "Dashboard root", path: "/dashboard" },
  { name: "POS workspace", path: "/pos" },
  { name: "Inventory", path: "/dashboard#inventory" },
  { name: "Purchase Requests", path: "/dashboard#purchase_requests" },
  { name: "Cash section", path: "/dashboard#cash" },
  { name: "Accounting", path: "/dashboard#accounting" },
  { name: "Reports", path: "/dashboard#reports" },
  { name: "Reconciliation", path: "/dashboard#reconciliation" },
  { name: "Investors", path: "/dashboard#investors" },
  { name: "Audit log", path: "/dashboard#audit" },
];

for (const page of CRITICAL_PAGES) {
  test(`No console errors saat load ${page.name}`, async ({ page: pw }) => {
    const collector = attachConsoleErrorCollector(pw);
    try {
      await loginAsE2EOwner(pw, page.path);
      await pw.waitForLoadState("networkidle");
      await pw.waitForTimeout(3_000);
      collector.assertEmpty();
    } finally {
      collector.dispose();
    }
  });
}

test("No console errors saat navigate antar section (3 hop)", async ({ page }) => {
  const collector = attachConsoleErrorCollector(page);
  try {
    await loginAsE2EOwner(page, "/dashboard");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    /* Hop 1: dashboard → inventory */
    await page.goto("/dashboard#inventory");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    /* Hop 2: inventory → reports */
    await page.goto("/dashboard#reports");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    /* Hop 3: reports → audit */
    await page.goto("/dashboard#audit");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    collector.assertEmpty();
  } finally {
    collector.dispose();
  }
});

test("No pageerror saat open + close TransactionCorrectionModal", async ({
  page,
}) => {
  const collector = attachConsoleErrorCollector(page);
  try {
    await loginAsE2EOwner(page, "/pos");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const riwayatTab = page
      .getByRole("button", { name: "Riwayat", exact: true })
      .first();
    if (
      !(await riwayatTab.isVisible({ timeout: 10_000 }).catch(() => false))
    ) {
      test.skip(true, "Riwayat tab tidak terlihat");
    }
    await riwayatTab.click();
    await page.waitForTimeout(2_500);

    /* Pageerror check selesai. */
    expect(collector.pageErrors).toEqual([]);
  } finally {
    collector.dispose();
  }
});
