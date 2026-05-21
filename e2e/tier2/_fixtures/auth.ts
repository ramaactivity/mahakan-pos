import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Sesi AE-85 — Auth helpers untuk Tier 2 tests.
 *
 * Pakai test user `e2e-owner@mahakan.local` dengan PIN '000000' yang
 * di-seed oleh global-setup.ts.
 *
 * Flow PIN login:
 *   1. Visit /pin (atau /pos yang auto-redirect ke /login → tap "Login
 *      dengan PIN" → /pin)
 *   2. Click user card "E2E Test Owner" di StaffAvatarGrid
 *   3. Tap digit '0' enam kali di PinPad
 *   4. Auto-submit kalau MAX_PIN_LENGTH tercapai + user selected
 *   5. NextAuth redirect ke / atau callbackUrl
 */

export const E2E_USER_NAME = "E2E Test Owner";
export const E2E_USER_PIN = "000000";

export async function loginAsE2EOwner(page: Page, callbackUrl?: string): Promise<void> {
  const target = callbackUrl
    ? `/pin?callbackUrl=${encodeURIComponent(callbackUrl)}`
    : "/pin";
  await page.goto(target);

  /* Wait until user grid loaded. */
  await expect(page.getByRole("radiogroup", { name: "Pilih user" })).toBeVisible({
    timeout: 15_000,
  });

  /* Click user radio dengan nama E2E Test Owner. */
  const userButton = page.getByRole("radio", { name: new RegExp(E2E_USER_NAME, "i") });
  await expect(userButton).toBeVisible();
  await userButton.click();

  /* Tap digit '0' six times via PinPad. */
  const digitButton = page.getByRole("button", { name: "0", exact: true }).first();
  await expect(digitButton).toBeVisible();
  for (let i = 0; i < E2E_USER_PIN.length; i++) {
    await digitButton.click();
  }

  /* Auto-submit triggered saat PIN length === MAX_PIN_LENGTH (6).
   * Tunggu navigate away dari /pin (means signIn success). */
  await page.waitForURL((url) => !url.pathname.startsWith("/pin"), {
    timeout: 15_000,
  });
}

export async function logout(page: Page): Promise<void> {
  /* Pakai NextAuth signout endpoint, atau click logout button kalau ada
   * di UI. Simplest: hit /api/auth/signout. */
  await page.goto("/api/auth/signout");
  /* NextAuth signout page = form CSRF token + submit button. */
  const signOutButton = page.getByRole("button", { name: /sign out|keluar/i });
  if (await signOutButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await signOutButton.click();
  }
}
