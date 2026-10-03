/**
 * Sesi AE-246 — sisa yang BELUM pindah, per (bulan, rekening asal).
 *
 * Dipisah dari `settlement-reclass-actions.ts` (file "use server") supaya bisa
 * diuji tanpa database: inilah bagian yang kalau salah membuat uang bergeser
 * dua kali tanpa gejala apa pun — jurnalnya tetap seimbang, jadi tidak ada
 * yang terlihat rusak sampai rekening koran dicocokkan.
 *
 * Kuncinya `"<YYYY-MM>|<kode rekening asal>"`: pemindahan dari rekening lain
 * di bulan yang sama tidak boleh ikut mengurangi.
 */
export function subtractAlreadyMoved<
  T extends { month: string; code: string; amount: number },
>(rows: T[], movedByKey: Map<string, number>): T[] {
  return rows
    .map((r) => ({
      ...r,
      amount: Math.max(0, r.amount - (movedByKey.get(`${r.month}|${r.code}`) ?? 0)),
    }))
    .filter((r) => r.amount > 0);
}
