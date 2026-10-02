/**
 * Sesi AE-244 — tarif lembur & telat dihitung PER JAM, bukan per menit.
 *
 * Arahan owner: "hitungan overtime diubah ke jam". Orang berpikir "lembur
 * Rp 15.000 per jam", bukan "Rp 250 per menit" — dan menit memaksa owner
 * membagi sendiri lalu membulatkan, yang ujungnya meleset dari maksudnya.
 *
 * Nilainya tetap disimpan dalam MENIT di absensi (presisi apa adanya);
 * yang berubah hanya satuan tarif dan cara menampilkannya.
 */

export interface PayrollRateSettings {
  /** Tarif baru, rupiah per JAM. */
  overtimePerHour?: number;
  latePerHour?: number;
  /** Tarif lama, rupiah per MENIT. Dibaca sebagai cadangan saja. */
  overtimePerMinute?: number;
  latePerMinute?: number;
}

/**
 * Tarif per jam yang berlaku. Outlet yang belum pernah mengisi tarif baru
 * tapi dulu sempat mengisi yang per menit tidak boleh mendadak jadi nol —
 * nilainya dinaikkan ×60 supaya uangnya tetap sama.
 */
export function resolveHourlyRates(settings: PayrollRateSettings | null | undefined): {
  overtimePerHour: number;
  latePerHour: number;
} {
  const s = settings ?? {};
  const pick = (perHour?: number, perMinute?: number): number => {
    if (typeof perHour === "number" && Number.isFinite(perHour) && perHour > 0) {
      return Math.round(perHour);
    }
    if (typeof perMinute === "number" && Number.isFinite(perMinute) && perMinute > 0) {
      return Math.round(perMinute * 60);
    }
    return 0;
  };
  return {
    overtimePerHour: pick(s.overtimePerHour, s.overtimePerMinute),
    latePerHour: pick(s.latePerHour, s.latePerMinute),
  };
}

/**
 * Rupiah dari menit × tarif per jam.
 *
 * Pembagian dilakukan SEKALI di akhir, bukan dengan mengubah tarif jadi
 * per-menit lebih dulu: Rp 15.000/jam itu Rp 250/menit tepat, tapi
 * Rp 10.000/jam menjadi Rp 166,67/menit — dibulatkan dulu, 8 jam lembur
 * meleset ratusan rupiah tanpa ada yang menyadarinya.
 */
export function amountFromMinutes(minutes: number, ratePerHour: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  if (!Number.isFinite(ratePerHour) || ratePerHour <= 0) return 0;
  return Math.round((minutes * ratePerHour) / 60);
}

/** "7,1 jam" — satu desimal, koma ala Indonesia. Menit <60 tetap jelas. */
export function formatHours(minutes: number | null | undefined): string {
  const m = Number(minutes ?? 0);
  if (!Number.isFinite(m) || m <= 0) return "0 jam";
  if (m < 60) return `${Math.round(m)} menit`;
  const hours = m / 60;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded.toLocaleString("id-ID", { maximumFractionDigits: 1 })} jam`;
}
