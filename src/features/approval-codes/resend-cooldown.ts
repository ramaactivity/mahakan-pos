/**
 * Sesi AE-196 — rem untuk tombol "Kirim ulang kode" di SEMUA modul approval.
 *
 * Tanpa rem ini satu ketukan berulang mengirim email + notifikasi HP ke Owner
 * sebanyak ketukannya. Lebih buruk lagi: tiap permintaan baru mencabut kode
 * sebelumnya, jadi kode yang sedang dibaca Owner keburu mati sebelum sempat
 * disebutkan — kasir dan Owner saling kejar-kejaran.
 *
 * File ini sengaja MURNI (tanpa db) supaya bisa dites langsung. Pembacaan
 * database-nya ada di `resend-cooldown-db.ts`.
 */
export const APPROVAL_RESEND_COOLDOWN_MS = 45_000;

/** Sisa detik yang harus ditunggu. 0 = boleh kirim. */
export function resendCooldownWaitSeconds(
  lastCreatedAt: Date | null | undefined,
  now: Date,
): number {
  if (!lastCreatedAt) return 0;
  const elapsedMs = now.getTime() - lastCreatedAt.getTime();
  /* Jam server bergeser mundur (atau baris dari masa depan) jangan sampai
   * mengunci kasir berjam-jam — perlakukan sebagai boleh kirim. */
  if (elapsedMs < 0) return 0;
  if (elapsedMs >= APPROVAL_RESEND_COOLDOWN_MS) return 0;
  return Math.ceil((APPROVAL_RESEND_COOLDOWN_MS - elapsedMs) / 1000);
}

export function resendCooldownMessage(waitSec: number): string {
  return `Kode baru saja dikirim ke Owner. Tunggu ${waitSec} detik lagi sebelum minta kode baru — kode yang lama masih berlaku.`;
}
