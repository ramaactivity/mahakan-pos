import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-89 — Open bill flow E2E.
 *
 * Save bill flow:
 *   1. Tab Kasir → add menu item
 *   2. Click "Simpan sebagai Open Bill" → OrderMetadataModal "save_bill" mode
 *   3. Fill customerName (wajib server-side per AE-48 audit)
 *   4. Submit → bill created dengan status='open' (deferStock=true)
 *   5. Verify di tab Bill Aktif muncul
 *
 * Tidak full close-bill flow (sudah covered di pos-transaction sebenarnya;
 * close-bill = same payment modal).
 */

test.describe.configure({ mode: "serial" });

const TS = Date.now();
const TEST_CUSTOMER_NAME = `E2E Customer ${TS}`;

test.describe("Open bill save flow", () => {
  test("Save bill dengan customer name", async ({ page }) => {
    await loginAsE2EOwner(page, "/pos");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    /* Navigate ke Kasir. */
    const kasirTab = page
      .getByRole("button", { name: "Kasir", exact: true })
      .first();
    await expect(kasirTab).toBeVisible({ timeout: 15_000 });
    await kasirTab.click();
    await page.waitForTimeout(2_000);

    const bodyText = await page.locator("body").innerText();
    test.skip(
      /Shift Belum Dibuka/i.test(bodyText),
      "Shift belum dibuka — run pos-transaction.spec.ts dulu",
    );

    /* Add menu item. */
    const menuTile = page
      .getByRole("button", { name: /Affogato|Americano|Bakmi/i })
      .first();
    await expect(menuTile).toBeVisible({ timeout: 15_000 });
    await menuTile.click();
    await page.waitForTimeout(1_500);

    /* Handle variant modal kalau ada. */
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const tambahDialog = dialog
        .getByRole("button", { name: /Tambah|Konfirmasi/i })
        .first();
      if (
        await tambahDialog.isVisible({ timeout: 500 }).catch(() => false)
      ) {
        await tambahDialog.click();
        await page.waitForTimeout(800);
      }
    }

    /* "Simpan sebagai Open Bill" tersembunyi di collapsible "Aksi Lain".
     * Buka dulu collapse. */
    const aksiLainToggle = page
      .getByRole("button", { name: /Aksi Lain/i })
      .first();
    if (
      await aksiLainToggle.isVisible({ timeout: 1_500 }).catch(() => false)
    ) {
      await aksiLainToggle.click();
      await page.waitForTimeout(500);
    }

    const saveBillBtn = page.getByRole("button", {
      name: /Simpan sebagai Open Bill/i,
    });
    await expect(saveBillBtn).toBeVisible({ timeout: 5_000 });
    await saveBillBtn.click();

    /* OrderMetadataModal "save_bill" mode — customer name wajib. */
    const metaDialog = page.getByRole("dialog");
    await expect(metaDialog).toBeVisible({ timeout: 10_000 });

    /* Fill nama customer (label "Nama Customer"). */
    const nameInput = metaDialog.getByLabel(/Nama Customer/i).first();
    if (await nameInput.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await nameInput.fill(TEST_CUSTOMER_NAME);
    } else {
      /* Fallback: first input in dialog. */
      await metaDialog.locator("input").first().fill(TEST_CUSTOMER_NAME);
    }

    /* Submit modal. Modal title "Simpan Bill" + button text "Simpan".
     * Pakai exact match supaya tidak conflict dengan heading. */
    const confirmBtn = metaDialog.getByRole("button", {
      name: "Simpan",
      exact: true,
    });
    await confirmBtn.click();

    /* Wait for modal close + bill save (Neon TLS delay). */
    await expect(metaDialog).not.toBeVisible({ timeout: 30_000 });
  });

  test("Bill aktif tab render (empty atau populated, tidak crash)", async ({
    page,
  }) => {
    await loginAsE2EOwner(page, "/pos");
    await page.waitForLoadState("networkidle");

    const billAktifTab = page
      .getByRole("button", { name: "Bill Aktif", exact: true })
      .first();
    await expect(billAktifTab).toBeVisible({ timeout: 15_000 });
    await billAktifTab.click();
    await page.waitForTimeout(2_500);

    /* Tab render — header + empty state ATAU bill rows. Verify header
     * "Bill Aktif" muncul + stat tiles. */
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/Bill Aktif|Total Bill|Outstanding/i);
    /* No error boundary. */
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception|application error/i,
    );
  });
});
