import type { ConsoleMessage, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Sesi AE-97 — Console error collector untuk Playwright tests.
 *
 * Catches silent JS bugs yang lolos dari body-text "something went wrong"
 * check. Sebelum AE-97, spec hanya cek error boundary fallback — tapi
 * banyak class bug yang console.error tanpa render error boundary (mis.
 * silent fetch failure, hydration warning, missing key).
 *
 * Cara pakai:
 *
 *   import { attachConsoleErrorCollector } from "./_fixtures/console-errors";
 *
 *   test.beforeEach(async ({ page }) => {
 *     const errors = attachConsoleErrorCollector(page);
 *     await loginAsE2EOwner(page, "/dashboard");
 *     // ... test
 *     errors.assertEmpty();   // fail kalau ada console.error unexpected
 *   });
 *
 * Atau pakai expectNoErrors helper:
 *
 *   await expectNoConsoleErrors(page, async () => {
 *     await someAction();
 *   });
 *
 * Whitelist pattern: error message yang match salah satu regex di
 * IGNORED_PATTERNS akan di-skip (mis. dev-mode HMR warning, third-party
 * noise). Tambahkan dengan hati-hati.
 */

const IGNORED_PATTERNS: RegExp[] = [
  /Download the React DevTools/i,
  /Fast Refresh had to perform a full reload/i,
  /\[HMR\]/i,
  /\[Fast Refresh\]/i,
  /Lit is in dev mode/i,
  /Hydration completed but contains mismatches/i,
  /Failed to load resource: net::ERR_FAILED.*\/_next\/static/i,
  /Image with src .* has /, // Next/image dev warnings
  /Web Bluetooth tidak didukung/i, // expected di non-Chrome/Edge
];

export interface ConsoleErrorCollector {
  /** All collected console.error / console.warn (level=error). */
  readonly errors: string[];
  /** All collected pageerror (uncaught exception). */
  readonly pageErrors: string[];
  /** Fail current test if errors collected. Pakai di akhir test. */
  assertEmpty: () => void;
  /** Clear collected for re-use within long test. */
  clear: () => void;
  /** Disconnect listeners. */
  dispose: () => void;
}

export function attachConsoleErrorCollector(
  page: Page,
  customIgnored: RegExp[] = [],
): ConsoleErrorCollector {
  const errors: string[] = [];
  const pageErrors: string[] = [];
  const allIgnored = [...IGNORED_PATTERNS, ...customIgnored];

  function isIgnored(text: string): boolean {
    return allIgnored.some((rx) => rx.test(text));
  }

  function onConsole(msg: ConsoleMessage): void {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isIgnored(text)) return;
    errors.push(text);
  }

  function onPageError(err: Error): void {
    const text = err.message;
    if (isIgnored(text)) return;
    pageErrors.push(text);
  }

  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  return {
    get errors() {
      return errors;
    },
    get pageErrors() {
      return pageErrors;
    },
    assertEmpty() {
      const combined = [
        ...errors.map((e) => `[console.error] ${e}`),
        ...pageErrors.map((e) => `[pageerror] ${e}`),
      ];
      expect(
        combined,
        `Console/page errors detected:\n${combined.join("\n")}`,
      ).toEqual([]);
    },
    clear() {
      errors.length = 0;
      pageErrors.length = 0;
    },
    dispose() {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}

/**
 * Convenience wrapper: jalankan action lalu assert no console errors.
 */
export async function expectNoConsoleErrors(
  page: Page,
  action: () => Promise<void>,
  customIgnored: RegExp[] = [],
): Promise<void> {
  const collector = attachConsoleErrorCollector(page, customIgnored);
  try {
    await action();
    collector.assertEmpty();
  } finally {
    collector.dispose();
  }
}
