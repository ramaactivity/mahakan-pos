/**
 * Sesi AE-248 — aturan potong MDR otomatis, di satu tempat.
 *
 * Owner mematikannya setelah rekonsiliasi dengan mutasi m-banking: potongan
 * yang ditebak dari persentase terlalu sering meleset dari yang benar-benar
 * dipotong bank. Menebak lalu salah lebih merepotkan daripada tidak menebak —
 * net dibiarkan sama dengan gross, lalu potongan yang NYATA dicatat per
 * tanggal lewat Revisi Settlement.
 *
 * Dipisah jadi fungsi murni karena defaultnya dibaca dari TIGA tempat
 * (resolveMdrConfig, getCashlessMdrConfig, dan hasil simpan); kalau salah
 * satunya memakai `!== false`, saklar ini menyala sendiri di jalur itu saja
 * dan potongan muncul lagi tanpa ada yang mengubah pengaturan.
 */

/** Belum pernah diset = MATI. Sengaja, bukan kelalaian. */
export function isAutoMdrEnabled(
  cashless: { autoMdrEnabled?: boolean } | null | undefined,
): boolean {
  return cashless?.autoMdrEnabled === true;
}

/** Potongan untuk satu baris settlement. Mati → 0, jadi net = gross. */
export function settlementFee(args: {
  autoMdrEnabled: boolean;
  pct: number;
  gross: number;
}): number {
  if (!args.autoMdrEnabled) return 0;
  if (!(args.gross > 0) || !(args.pct > 0)) return 0;
  return Math.round((args.gross * args.pct) / 100);
}
