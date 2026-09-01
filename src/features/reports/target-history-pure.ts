/**
 * Sesi AE-223 — aturan memilih target bulanan untuk satu bulan.
 *
 * Dipisah sebagai fungsi murni karena inilah bagian yang paling mudah salah
 * dan paling mahal kalau salah: memakai target yang berlaku SEKARANG untuk
 * menilai bulan lampau menghasilkan persentase yang terlihat resmi padahal
 * patokannya tidak pernah berlaku saat itu.
 */

export interface MonthlyTargetSettings {
  /** Target yang berlaku sekarang. */
  monthlyRevenue?: number;
  /** Target yang DIKUNCI per bulan: { "2026-08": 40000000 }. */
  monthlyHistory?: Record<string, number>;
}

export interface ResolvedMonthlyTarget {
  target: number | null;
  /** true = angkanya memang dikunci untuk bulan itu. */
  fromHistory: boolean;
}

export function resolveMonthlyTarget(
  month: string,
  targets: MonthlyTargetSettings | null | undefined,
): ResolvedMonthlyTarget {
  const t = targets ?? {};
  const locked = t.monthlyHistory?.[month];
  /* Angka yang dikunci menang, termasuk kalau nilainya 0 — "target bulan itu
   * memang nol" adalah pernyataan yang sah dan tidak boleh diam-diam jatuh
   * ke target sekarang. */
  if (typeof locked === "number" && Number.isFinite(locked)) {
    return { target: locked, fromHistory: true };
  }
  const now = t.monthlyRevenue;
  return {
    target: typeof now === "number" && Number.isFinite(now) ? now : null,
    fromHistory: false,
  };
}
