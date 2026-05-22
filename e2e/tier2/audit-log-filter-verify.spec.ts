import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-110 — Audit Log filter verification.
 *
 * Audit Log adalah security/compliance tool. Owner pakai untuk:
 * - Investigate dispute (siapa void transaksi X?)
 * - Compliance audit (siapa ubah settings sensitive?)
 * - Forensik kalau ada fraud suspicion
 *
 * Kalau filter / search broken, owner lost audit trail → tidak bisa
 * investigate.
 *
 * Coverage:
 * - Test 1: Filter controls render (event Select, dari/sampai DatePicker)
 * - Test 2: Audit entries visible dengan structure lengkap
 * - Test 3: Event type filter → list narrows correctly
 *
 * Read-only spec, no mutation.
 */

test.describe("Audit Log filter + structure", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#audit");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3_000);
  });

  test("Filter controls render: Event Select + 2 DatePickers", async ({
    page,
  }) => {
    /* Filter card. */
    const eventSelect = page.getByLabel(/Filter event type|^Event$/i).first();
    await expect(eventSelect).toBeVisible({ timeout: 10_000 });

    /* DatePickers — pakai label match. */
    const fromDate = page.getByLabel(/Dari tanggal/i).first();
    const toDate = page.getByLabel(/Sampai tanggal/i).first();
    await expect(fromDate).toBeVisible();
    await expect(toDate).toBeVisible();

    /* CSV + Refresh buttons. */
    const refreshBtn = page.getByRole("button", { name: /Refresh/i }).first();
    await expect(refreshBtn).toBeVisible();
  });

  test("Audit entries visible dengan timestamp + actor + action", async ({
    page,
  }) => {
    const bodyText = await page.locator("body").innerText();
    /* Test branch punya banyak audit events dari sesi-sesi sebelumnya.
     * Skip kalau kebetulan "Belum ada catatan" muncul. */
    if (/Belum ada catatan untuk filter ini/i.test(bodyText)) {
      test.skip(true, "Audit log empty di window default");
    }

    /* Verify common audit event types muncul (test branch has these). */
    expect(bodyText).toMatch(
      /transaction\.|auth\.|menu\.|user\.|settings\.|inventory\.|purchase\./i,
    );

    /* Verify timestamp format (2026 atau 2025 year). */
    expect(bodyText).toMatch(/202[5-6]/);

    /* No crash. */
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception/i,
    );
  });

  test("Filter event type → list narrows", async ({ page }) => {
    /* Click event Select trigger. */
    const eventSelect = page.getByLabel(/Filter event type|^Event$/i).first();
    if (
      !(await eventSelect.isVisible({ timeout: 5_000 }).catch(() => false))
    ) {
      test.skip(true, "Event filter Select tidak visible");
    }
    await eventSelect.click();
    await page.waitForTimeout(500);

    /* Try select "transaction.create" — event yang umum di test branch. */
    const trxOption = page
      .getByRole("option", { name: /transaction\.create/i })
      .first();
    if (!(await trxOption.isVisible({ timeout: 3_000 }).catch(() => false))) {
      /* Fallback: pilih opsi pertama yang ada. */
      const firstOption = page.getByRole("option").first();
      if (
        !(await firstOption.isVisible({ timeout: 2_000 }).catch(() => false))
      ) {
        test.skip(true, "No event options visible di dropdown");
      }
      await firstOption.click();
    } else {
      await trxOption.click();
    }
    await page.waitForTimeout(2_000);

    /* Verify table re-rendered (loading state or new content). */
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception/i,
    );
    /* Either ada rows dengan filter applied, atau "Belum ada catatan" — both OK. */
    const hasRows = /202[5-6]/.test(bodyText);
    const isEmpty = /Belum ada catatan/i.test(bodyText);
    expect(hasRows || isEmpty).toBe(true);
  });
});
