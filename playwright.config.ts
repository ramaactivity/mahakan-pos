import { defineConfig, devices } from "@playwright/test";

/**
 * Sesi AE-85 — Playwright E2E config untuk Mahakan POS.
 *
 * Target URL prioritas:
 *   1. PLAYWRIGHT_BASE_URL env var (eksplisit override)
 *   2. NEXT_PUBLIC_APP_URL kalau set (e.g., preview deploy)
 *   3. https://mahakan-pos.vercel.app (prod default — smoke read-only saja)
 *
 * Mode:
 *   - Tier 1 (smoke, read-only) — aman jalan di prod URL. Test render
 *     halaman + auth redirect. Tidak mutate data.
 *   - Tier 2 (mutation, butuh auth) — wajib target test environment
 *     (Neon branch atau local DB), JANGAN run di prod. Folder e2e/tier2/
 *     dipisahkan supaya tidak ke-run accidentally.
 *
 * Run:
 *   npx playwright test                  # Tier 1 smoke (default)
 *   npx playwright test e2e/tier2        # Tier 2 (butuh env setup)
 *   npx playwright test --ui             # UI mode (debug)
 *   npx playwright show-report           # liat hasil terakhir
 */

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "https://mahakan-pos.vercel.app";

export default defineConfig({
  testDir: "./e2e",
  /* Tier 2 (mutation) — explicit folder, default test command skip. */
  testIgnore: process.env.E2E_INCLUDE_TIER2 ? undefined : ["**/tier2/**"],

  /* Sesi AE-85 — Global setup hanya untuk Tier 2 (membutuhkan .env.test).
   * Tier 1 smoke tidak butuh setup. */
  globalSetup: process.env.E2E_INCLUDE_TIER2
    ? "./e2e/tier2/_fixtures/global-setup.ts"
    : undefined,

  /* Auto-spawn next dev di port 3001 dengan .env.test loaded, hanya untuk
   * Tier 2. Tier 1 target prod URL langsung jadi tidak butuh webServer. */
  webServer: process.env.E2E_INCLUDE_TIER2
    ? {
        command: "npm run dev:e2e",
        url: "http://localhost:3001",
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        stdout: "pipe",
        stderr: "pipe",
      }
    : undefined,

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    /* Hindari auto-accept dialogs (we want explicit handling). */
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      /* Sesi AE-85 — Galaxy A7 Lite tablet target (per Mahakan POS primary
       * device — lihat memory feedback_pos_primary_device.md). 1340×800
       * landscape adalah tablet kasir di outlet. */
      name: "tablet-galaxy-a7-lite",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 1340, height: 800 },
        isMobile: false,
        hasTouch: true,
      },
    },
    {
      name: "mobile-android",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
