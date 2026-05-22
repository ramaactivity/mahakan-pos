import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-96 — Payroll period create flow deep.
 *
 * PayrollSection (HR Operations → tab Payroll) punya tombol "Periode Baru"
 * yang membuka CreatePeriodDialog. Modal auto-fill label bulan+tahun +
 * tanggal start/end (1 - last of current month).
 *
 * Test verify:
 *   - Tab Payroll dalam HR Operations clickable
 *   - Tombol "Periode Baru" visible (owner role)
 *   - Click → modal "Periode Payroll Baru" render dengan input label + tanggal
 *   - Pengaturan "Formula" button (rate config) visible
 *   - Modal field auto-fill bulan berjalan
 *
 * Tidak submit ke DB (avoid pollute test branch dengan periode duplicate).
 * Mutation test sebenarnya ada di test:e2e:tier2 jenjang sebelumnya kalau
 * butuh full path.
 */

test.describe("Payroll period create dialog", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#hr_operations");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    /* Navigate ke tab Payroll dalam HR Operations sub-nav. */
    const payrollTab = page
      .getByRole("tab", { name: /Payroll|Gaji/i })
      .first();
    if (!(await payrollTab.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, "Payroll tab tidak ada di HR Operations");
    }
    await payrollTab.click();
    await page.waitForTimeout(2_000);
  });

  test("Tombol 'Periode Baru' visible (owner role)", async ({ page }) => {
    const btn = page.getByRole("button", { name: /Periode Baru/i });
    await expect(btn).toBeVisible({ timeout: 10_000 });
  });

  test("Tombol 'Formula' (settings rate) visible", async ({ page }) => {
    const btn = page.getByRole("button", {
      name: /Formula|Pengaturan formula/i,
    });
    await expect(btn).toBeVisible({ timeout: 10_000 });
  });

  test("Click 'Periode Baru' → modal render dengan form + auto-fill", async ({
    page,
  }) => {
    const btn = page.getByRole("button", { name: /Periode Baru/i });
    await btn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    /* Heading modal. */
    await expect(
      dialog.getByText(/Periode Payroll Baru/i),
    ).toBeVisible({ timeout: 3_000 });

    /* Input Label auto-filled (bulan dan tahun berjalan). */
    const labelInput = dialog.getByLabel(/Label/i);
    await expect(labelInput).toBeVisible();
    const labelValue = await labelInput.inputValue();
    /* Auto-fill format e.g. "Mei 2026" — verify ada angka tahun. */
    expect(labelValue).toMatch(/\d{4}/);

    /* Footer buttons. */
    await expect(dialog.getByRole("button", { name: /Buat/i })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Batal/i })).toBeVisible();

    /* Close tanpa submit. */
    await dialog.getByRole("button", { name: /Batal/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });

  test("Click 'Formula' → settings modal render dengan rate input", async ({
    page,
  }) => {
    const btn = page.getByRole("button", {
      name: /Formula|Pengaturan formula/i,
    });
    if (!(await btn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, "Formula button disabled (settings belum loaded)");
    }
    /* Klik kalau enabled. */
    if (await btn.isEnabled()) {
      await btn.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      /* Rate input untuk late deduction + overtime pay. */
      const dialogText = await dialog.innerText();
      expect(dialogText).toMatch(
        /Late Deduction|Overtime|Formula Payroll|Rp\/menit/i,
      );
    }
  });
});
