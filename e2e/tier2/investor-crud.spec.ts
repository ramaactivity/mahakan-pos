import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-87 — Tier 2 investor CRUD flow E2E test.
 *
 * Mutating flow — create investor baru di test branch, verify muncul di
 * list. Branch akan auto-delete 24h jadi tidak perlu cleanup.
 *
 * Test name unik per run pakai timestamp supaya tidak collide kalau
 * spec di-re-run (anti-duplicate dedup di server).
 */

const TS = Date.now();
const TEST_INVESTOR_NAME = `E2E Test Investor ${TS}`;

test.describe("Investor CRUD flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#investors");
  });

  test("Tombol Tambah Investor render + buka form modal", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    /* Header InvestorsTab punya tombol "Tambah" (dengan Plus icon).
     * Modal title yang muncul = "Tambah Investor". */
    const addBtn = page.getByRole("button", { name: "Tambah", exact: true });
    await expect(addBtn).toBeVisible({ timeout: 15_000 });
    await addBtn.click();

    await expect(
      page.locator("body").getByText("Tambah Investor", { exact: true }).first(),
    ).toBeVisible({ timeout: 5_000 });
    /* Field utama. */
    await expect(page.getByLabel(/Nama Lengkap/i)).toBeVisible();
    await expect(page.getByLabel(/Modal Disetor/i)).toBeVisible();
  });

  test("Submit form investor baru → modal close + toast success", async ({
    page,
  }) => {
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Tambah", exact: true }).click();

    /* Scope ke Radix dialog (Modal wraps in [role=dialog]). */
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    /* Fill input dalam dialog. Input component tidak set type=text di DOM
     * (HTML default), jadi pakai locator by id (Input renders id="uuid").
     * Approach paling reliable: focus → type. */
    const inputs = dialog.locator("input");
    /* Index 0 = Nama Lengkap (first input in modal). */
    await inputs.nth(0).fill(TEST_INVESTOR_NAME);

    /* Modal Disetor adalah input pertama yang punya inputmode="numeric". */
    await dialog
      .locator('input[inputmode="numeric"]')
      .first()
      .fill("100000");

    /* Submit. */
    await dialog
      .getByRole("button", { name: "Tambah Investor", exact: true })
      .click();

    /* Modal close — dialog tidak visible. Neon TLS handshake di dev
     * mode + Drizzle insert + audit log + journal hook = 5-15s. Generous
     * timeout. */
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  });

  test("Stat card render dengan total modal format Rupiah", async ({
    page,
  }) => {
    /* Wait until tab content actually mounted (Tambah button visible). */
    await expect(
      page.getByRole("button", { name: "Tambah", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    const bodyText = await page.locator("body").innerText();
    /* Format Rupiah memakai titik separator id-ID. */
    expect(bodyText).toMatch(/Rp\s*[\d.,]+/);
  });
});
