import type { Locator, Page } from "@playwright/test";

/**
 * Sesi AE-97 — Wait helpers untuk replace `page.waitForTimeout(N)` smell
 * (F2 improvement).
 *
 * `waitForTimeout` adalah sleep arbitrary. Fragile (too short → flaky,
 * too long → slow), tidak menjelaskan apa yang ditunggu. Helpers ini
 * tunggu kondisi spesifik: heading element, role+name, atau callback
 * arbitrary.
 *
 * Pattern migration:
 *
 *   // SEBELUM
 *   await loginAsE2EOwner(page, "/dashboard#cash");
 *   await page.waitForLoadState("networkidle");
 *   await page.waitForTimeout(2_500); // hope page settles
 *
 *   // SESUDAH
 *   await loginAsE2EOwner(page, "/dashboard#cash");
 *   await waitForSectionReady(page, /Kas|Petty Cash/i);
 *
 * Kalau section punya heading h1/h2/h3 spesifik, ini lebih reliable.
 */

export interface WaitForSectionOpts {
  /** Total timeout (default 15s). */
  timeout?: number;
  /** Extra sleep after heading visible (untuk component dengan deeper lazy-load). */
  settleMs?: number;
}

/**
 * Wait sampai section heading visible. Combine dengan `networkidle`
 * yang sudah jalan upstream — heading visibility = section sudah mount.
 *
 * Note: SettingsSection / CardTitle pakai h3, jadi `getByRole("heading")`
 * catch semua h1-h6.
 */
export async function waitForSectionReady(
  page: Page,
  headingPattern: RegExp | string,
  opts: WaitForSectionOpts = {},
): Promise<void> {
  const timeout = opts.timeout ?? 15_000;
  const heading = page
    .getByRole("heading", { name: headingPattern })
    .first();
  await heading.waitFor({ state: "visible", timeout });
  if (opts.settleMs) {
    await page.waitForTimeout(opts.settleMs);
  }
}

/**
 * Wait sampai dialog/modal visible dengan optional name match. Useful
 * untuk verify modal terbuka setelah click trigger.
 */
export async function waitForDialog(
  page: Page,
  opts: { name?: RegExp | string; timeout?: number } = {},
): Promise<Locator> {
  const timeout = opts.timeout ?? 10_000;
  const dialog = opts.name
    ? page.getByRole("dialog", { name: opts.name })
    : page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout });
  return dialog;
}

/**
 * Wait sampai element tertentu tidak visible (mis. spinner hilang,
 * skeleton selesai, modal close).
 */
export async function waitForHidden(
  locator: Locator,
  timeout = 10_000,
): Promise<void> {
  await locator.waitFor({ state: "hidden", timeout });
}

/**
 * Pakai untuk replace `page.waitForTimeout(N)` ketika sebenarnya yang
 * ditunggu adalah "next idle frame". Cocok untuk wait React state
 * propagate setelah click.
 */
export async function waitForIdle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  /* RequestIdleCallback equivalent — wait sampai event loop idle. */
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(() => resolve(), { timeout: 1_000 });
        } else {
          setTimeout(resolve, 250);
        }
      }),
  );
}
