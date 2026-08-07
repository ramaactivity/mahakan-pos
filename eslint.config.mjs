import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Mahakan-specific:
    "coverage/**",
    "drizzle/**",
    "node_modules/**",
    // Serwist-generated service worker bundle (committed by build, gitignored)
    "public/sw.js",
    "public/sw.js.map",
    "public/swe-worker-*.js",
    "public/swe-worker-*.js.map",
  ]),
  /**
   * Sesi AE-191 — larang "tanggal hari ini versi UTC".
   *
   * `new Date().toISOString().slice(0, 10)` itu tanggal UTC. Antara
   * 00:00–06:59 WIB, UTC masih hari kemarin — jurnal/laporan/form mendarat di
   * hari (bahkan bulan, tiap tanggal 1) yang salah, lalu "hilang" dari filter
   * tanggal hari ini. Kejadian nyata: jurnal Lain-lain Rp 200.000 dianggap
   * hilang oleh owner. Pakai `todayJakarta()` dari `@/lib/tz`.
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/tz.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          /* Sengaja HANYA `new Date()` tanpa argumen = "sekarang".
           * `new Date(Date.UTC(y, m, 0))` dan `new Date(ts + 7 jam)` adalah
           * pola yang memang benar — aturan yang ikut menandai itu cuma jadi
           * berisik lalu dimatikan orang. Untuk instant tertentu, pakai
           * `jakartaDateOf(d)`; itu urusan review, bukan lint. */
          selector:
            "CallExpression[callee.object.callee.object.type='NewExpression'][callee.object.callee.object.callee.name='Date'][callee.object.callee.object.arguments.length=0][callee.object.callee.property.name='toISOString'][callee.property.name=/^(slice|substring)$/]",
          message:
            "Tanggal UTC, bukan WIB — antara 00:00–06:59 WIB ini memberi tanggal KEMARIN. Pakai todayJakarta() dari @/lib/tz.",
        },
      ],
    },
  },
]);

export default eslintConfig;
