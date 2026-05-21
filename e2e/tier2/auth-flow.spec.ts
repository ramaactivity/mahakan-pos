import { expect, test } from "@playwright/test";
import { E2E_USER_NAME, loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-85 — Tier 2 auth flow tests.
 *
 * Verify PIN login + session cookie + redirect flow bekerja.
 * Foundation untuk semua Tier 2 specs lainnya.
 */

test.describe("PIN login flow", () => {
  test("E2E owner user dapat login via PIN dan landed di dashboard", async ({
    page,
  }) => {
    await loginAsE2EOwner(page);
    /* Should redirect ke dashboard atau pos. */
    const url = page.url();
    expect(url).toMatch(/\/(dashboard|pos|$)/);
  });

  test("Login with PIN preserve callbackUrl", async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("Session cookie set setelah login", async ({ page, context }) => {
    await loginAsE2EOwner(page);
    const cookies = await context.cookies();
    /* NextAuth set session-token cookie (name varies: __Secure-... atau next-auth.session-token) */
    const sessionCookie = cookies.find(
      (c) =>
        c.name.includes("session-token") ||
        c.name.includes("authjs.session-token"),
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie!.value.length).toBeGreaterThan(0);
  });

  test("Dashboard render dengan greeting user name", async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard");
    await page.waitForLoadState("networkidle");
    /* Dashboard biasanya tampilkan name di header. Cari subset case-insensitive. */
    const body = await page.locator("body").innerText();
    expect(body.toLowerCase()).toContain("e2e test owner".toLowerCase().slice(0, 8));
  });
});
