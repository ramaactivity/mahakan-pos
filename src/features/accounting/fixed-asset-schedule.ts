/**
 * Sesi AE-214 — jadwal penyusutan yang sadar REVALUASI & PENURUNAN NILAI.
 *
 * Sebelum ini penyusutan selalu diturunkan dari satu rumus tetap: harga
 * perolehan dibagi umur manfaat, dihitung ulang dari bulan akuisisi setiap
 * kali dibutuhkan. Rumus itu benar selama nilai aset tidak pernah berubah —
 * dan berhenti benar begitu asetnya direvaluasi atau turun nilai, karena
 * penyusutan sesudahnya harus memakai NILAI TERCATAT BARU dibagi SISA umur
 * manfaat (PSAK 16 par. 60-62 & PSAK 48 par. 63).
 *
 * Karena itu aset sekarang punya "basis": nilai dasar penyusutan yang berlaku
 * sejak bulan tertentu. Selama `basisMonth` masih null, seluruh perhitungan
 * jatuh persis ke rumus lama — aset yang tidak pernah dinilai ulang tidak
 * berubah angkanya sama sekali.
 *
 * Bulan-bulan SEBELUM basis tidak pernah dihitung ulang; jumlahnya dibekukan
 * di `basisAccumulated` saat peristiwa penilaian dicatat. Ini bukan
 * penyederhanaan malas: begitu penyusutan sebuah bulan sudah diposting ke
 * jurnal, angkanya adalah fakta buku besar, bukan sesuatu yang boleh
 * dihitung ulang oleh rumus yang berubah belakangan.
 */

import { computeMonthlyDepreciation } from "./mapping/fixedAsset";

export type DepreciationSchedule = {
  /** YYYY-MM-DD tanggal perolehan. */
  acquiredDate: string;
  /** Harga perolehan historis (tidak pernah berubah). */
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  /** Nilai dasar penyusutan berjalan. Null = belum pernah dinilai ulang. */
  basisAmount: number | null;
  /** YYYY-MM-01, bulan PERTAMA yang disusutkan dengan basis ini. */
  basisMonth: string | null;
  /** Akumulasi penyusutan yang tetap tercatat di buku dari sebelum basis. */
  basisAccumulated: number;
  /** Sisa umur manfaat (bulan) terhitung sejak `basisMonth`. */
  basisRemainingMonths: number | null;
};

/** Selisih bulan kalender antara dua tanggal ISO (YYYY-MM-DD). */
export function monthsBetweenIso(fromIso: string, toIso: string): number {
  const [fy, fm] = fromIso.split("-").map(Number);
  const [ty, tm] = toIso.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** "2026-08-17" → "2026-08-01". */
export function firstDayOfMonthIso(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** "2026-08-01" → "2026-09-01" (n boleh negatif). */
export function addMonthsIso(monthFirstDay: string, n: number): string {
  const [y, m] = monthFirstDay.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

function hasBasis(
  s: DepreciationSchedule,
): s is DepreciationSchedule & {
  basisAmount: number;
  basisMonth: string;
  basisRemainingMonths: number;
} {
  return (
    s.basisMonth !== null &&
    s.basisAmount !== null &&
    s.basisRemainingMonths !== null
  );
}

/**
 * Penyusutan untuk SATU bulan target (YYYY-MM-01).
 *
 * Bulan sebelum `basisMonth` mengembalikan 0 — bukan karena nilainya nol,
 * tapi karena bulan-bulan itu sudah terkunci di `basisAccumulated` dan tidak
 * boleh ikut dihitung dua kali oleh pemanggil mana pun.
 */
export function monthlyDepreciationFor(
  s: DepreciationSchedule,
  targetMonthFirstDay: string,
): number {
  const target = firstDayOfMonthIso(targetMonthFirstDay);

  if (!hasBasis(s)) {
    const monthIndex =
      monthsBetweenIso(firstDayOfMonthIso(s.acquiredDate), target) + 1;
    return computeMonthlyDepreciation({
      cost: s.cost,
      salvageValue: s.salvageValue,
      usefulLifeMonths: s.usefulLifeMonths,
      monthIndex,
    });
  }

  if (target < s.basisMonth) return 0;

  const monthIndex = monthsBetweenIso(s.basisMonth, target) + 1;
  return computeMonthlyDepreciation({
    cost: s.basisAmount,
    salvageValue: s.salvageValue,
    usefulLifeMonths: s.basisRemainingMonths,
    monthIndex,
  });
}

/**
 * Akumulasi penyusutan yang TERCATAT DI BUKU sampai `lastDepreciatedMonth`
 * (inklusif). Null = belum pernah disusutkan sama sekali.
 */
export function accumulatedDepreciationThrough(
  s: DepreciationSchedule,
  lastDepreciatedMonth: string | null,
): number {
  if (!lastDepreciatedMonth) {
    /* Belum ada bulan yang diposting. Kalau asetnya pernah dinilai ulang,
     * akumulasi sebelum basis tetap ada di buku (jalur penurunan nilai tidak
     * menghapus 1290). */
    return hasBasis(s) ? s.basisAccumulated : 0;
  }
  const last = firstDayOfMonthIso(lastDepreciatedMonth);

  if (!hasBasis(s)) {
    const months = monthsBetweenIso(firstDayOfMonthIso(s.acquiredDate), last) + 1;
    let acc = 0;
    for (let i = 1; i <= months; i++) {
      acc += computeMonthlyDepreciation({
        cost: s.cost,
        salvageValue: s.salvageValue,
        usefulLifeMonths: s.usefulLifeMonths,
        monthIndex: i,
      });
    }
    return acc;
  }

  let acc = s.basisAccumulated;
  if (last >= s.basisMonth) {
    const months = monthsBetweenIso(s.basisMonth, last) + 1;
    for (let i = 1; i <= months; i++) {
      acc += computeMonthlyDepreciation({
        cost: s.basisAmount,
        salvageValue: s.salvageValue,
        usefulLifeMonths: s.basisRemainingMonths,
        monthIndex: i,
      });
    }
  }
  return acc;
}

/**
 * Bulan-bulan yang SEHARUSNYA sudah disusutkan sampai `throughMonth` tapi
 * belum pernah diposting.
 *
 * Dipakai penilaian ulang sebagai penghalang: nilai tercatat yang dipakai
 * menghitung selisih revaluasi harus sudah memuat seluruh penyusutan sampai
 * tanggal efektifnya. Kalau tidak, selisihnya menyerap penyusutan yang belum
 * dijurnal dan mendarat di ekuitas — salah tempat, dan tidak akan pernah
 * ketahuan dari layar mana pun.
 */
export function pendingDepreciationMonths(
  s: DepreciationSchedule,
  throughMonthFirstDay: string,
  lastDepreciatedMonth: string | null,
): string[] {
  const through = firstDayOfMonthIso(throughMonthFirstDay);
  const start = lastDepreciatedMonth
    ? addMonthsIso(firstDayOfMonthIso(lastDepreciatedMonth), 1)
    : firstDayOfMonthIso(s.acquiredDate);

  const out: string[] = [];
  for (let m = start; m <= through; m = addMonthsIso(m, 1)) {
    if (monthlyDepreciationFor(s, m) > 0) out.push(m);
    /* Jaga-jaga terhadap rentang tak masuk akal (tanggal salah ketik). */
    if (out.length > 600) break;
  }
  return out;
}
