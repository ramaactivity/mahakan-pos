import "server-only";

/**
 * Sesi AE-182 — `runAfterResponse`: jalankan kerja pasca-response TANPA
 * kehilangan pekerjaan saat instance serverless dibekukan.
 *
 * MASALAH YANG DIPERBAIKI (audit 2026-08-04):
 * Pola lama `doSomething().catch(...)` di server action = fire-and-forget
 * MURNI. Di Vercel, begitu response dikirim, instance boleh dibekukan /
 * dimatikan kapan saja. Promise yang masih jalan ikut mati di tengah query
 * → socket ke Neon putus → "Connection terminated unexpectedly", dan yang
 * lebih parah: blok `.catch()` ikut mati sehingga tidak ada audit log dan
 * tidak ada baris retry-queue. Hilang senyap.
 *
 * Data produksi membuktikan: dari 855 transaksi POS lunas yang jurnalnya
 * tidak pernah tercatat, hanya 19 yang sempat masuk antrian retry. Rate
 * jurnal berhasil turun dari 90% (kalau ada transaksi lain < 2 menit
 * kemudian, instance kebangun lagi) jadi 35% (kalau POS sepi > 30 menit).
 *
 * SOLUSI: `after()` dari next/server. Di Vercel ini dipetakan ke
 * `waitUntil()` — platform menahan instance sampai promise selesai, tapi
 * response ke kasir tetap dikirim duluan (POS tidak melambat).
 *
 * Fallback: di luar request scope (script CLI, unit test, seeding) `after()`
 * melempar error. Di situ kita jalankan promise-nya langsung — perilaku
 * lama, tapi konteks itu memang bukan serverless jadi aman.
 */

import { after } from "next/server";

/**
 * Jalankan `fn` setelah response terkirim, tapi tetap dijamin selesai.
 *
 * `fn` HARUS menangani error-nya sendiri (atau siap error-nya di-log di
 * sini) — runAfterResponse tidak pernah melempar ke pemanggil.
 *
 * @param fn    kerja async yang mau dijalankan pasca-response
 * @param label untuk log kalau gagal total
 */
export function runAfterResponse(
  fn: () => Promise<unknown>,
  label: string,
): void {
  const guarded = () =>
    Promise.resolve()
      .then(fn)
      .catch((e) => {
        console.error(`[after-response:${label}]`, e);
      });

  try {
    /* Bentuk callback, BUKAN `after(guarded())`. Kalau promise-nya dibuat
     * duluan lalu `after()` melempar, kerjanya jalan DUA KALI (sekali dari
     * promise yang terlanjur mulai, sekali dari fallback). */
    after(guarded);
  } catch {
    /* Di luar request scope (script CLI / unit test) `after()` melempar —
     * fallback ke detached seperti perilaku lama. */
    void guarded();
  }
}
