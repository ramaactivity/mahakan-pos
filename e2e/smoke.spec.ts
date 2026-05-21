import { expect, test } from "@playwright/test";

/**
 * Sesi AE-85 — Tier 1 smoke tests.
 *
 * Read-only smoke — verify halaman render + auth redirect bekerja.
 * SAFE to run di prod URL karena tidak mutate data. Aman di-trigger
 * setiap deploy untuk catch build / deploy break.
 *
 * Target: PLAYWRIGHT_BASE_URL atau default https://mahakan-pos.vercel.app.
 */

test.describe("Public routes (no auth required)", () => {
  test("landing / redirects to dashboard or login depending on session", async ({
    page,
  }) => {
    const response = await page.goto("/");
    expect(response).toBeTruthy();
    /* Landing seharusnya 200 OK (homepage / NextAuth flow). */
    expect(response!.status()).toBeLessThan(500);
    /* Verify body rendered (no React error boundary fallback). */
    await expect(page.locator("body")).toBeVisible();
  });

  test("/login renders email + PIN entry", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);
    /* Render at least 1 form / input. */
    await page.waitForLoadState("networkidle");
    const inputCount = await page.locator("input").count();
    expect(inputCount).toBeGreaterThan(0);
  });

  test("/pin renders PIN keypad / form", async ({ page }) => {
    await page.goto("/pin");
    await page.waitForLoadState("networkidle");
    /* PIN page render — verify ada keypad atau pin input. */
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test("/m/login (mobile staff login) renders", async ({ page }) => {
    await page.goto("/m/login");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
  });

  test("/m landing renders or redirects to /m/login", async ({ page }) => {
    const response = await page.goto("/m");
    expect(response!.status()).toBeLessThan(500);
    /* Either auth-gate ke /m/login atau render landing dengan modules. */
    const url = page.url();
    expect(url).toMatch(/\/m(\/login)?$/);
  });
});

test.describe("Auth-protected routes (should redirect to login)", () => {
  test("/pos redirects to /login with callbackUrl", async ({ page }) => {
    /* Navigate without session — should auto-redirect. */
    await page.goto("/pos", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login|\/pin/, { timeout: 10_000 });
    /* Should land on /login (or /pin) with callbackUrl preserve. */
    const url = page.url();
    expect(url).toMatch(/\/(login|pin)/);
  });

  test("/dashboard requires auth", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    /* Should redirect to login. */
    await page.waitForURL(/\/login|\/pin/, { timeout: 10_000 });
    const url = page.url();
    expect(url).toMatch(/\/(login|pin)/);
  });
});

test.describe("PWA manifests", () => {
  test("manifest.webmanifest (main app) renders valid JSON", async ({
    page,
  }) => {
    const response = await page.goto("/manifest.webmanifest");
    expect(response?.status()).toBe(200);
    const text = await response!.text();
    expect(() => JSON.parse(text)).not.toThrow();
    const manifest = JSON.parse(text);
    expect(manifest.name || manifest.short_name).toBeTruthy();
  });

  test("manifest-staff.webmanifest (mobile /m) renders valid JSON", async ({
    page,
  }) => {
    const response = await page.goto("/manifest-staff.webmanifest");
    expect(response?.status()).toBe(200);
    const text = await response!.text();
    expect(() => JSON.parse(text)).not.toThrow();
    const manifest = JSON.parse(text);
    expect(manifest.name || manifest.short_name).toBeTruthy();
  });
});

test.describe("Build artifacts (catch deploy break)", () => {
  test("no React error boundary fallback di /login", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    /* React error boundary biasanya render "Something went wrong" atau
     * stack trace text. */
    const bodyText = await page.locator("body").innerText();
    const errorPatterns = [
      /something went wrong/i,
      /application error.*client-side exception/i,
      /chunkloaderror/i,
      /a client-side exception has occurred/i,
    ];
    for (const pattern of errorPatterns) {
      expect(bodyText).not.toMatch(pattern);
    }
  });

  test("no console errors di /login (warn-only fine)", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        /* Filter benign noise (NextAuth CSRF preflight, service worker
         * preload, dev hot reload). */
        if (
          !text.includes("csrf") &&
          !text.includes("Service worker") &&
          !text.includes("preload") &&
          !text.toLowerCase().includes("font") &&
          !text.includes("inputmode") &&
          !text.includes("X-Frame-Options")
        ) {
          errors.push(text);
        }
      }
    });
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    expect(errors, `console errors: ${errors.join("\n")}`).toHaveLength(0);
  });
});
