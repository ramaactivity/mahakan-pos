/**
 * Sesi AE-211 — Jurnal Penyesuaian (adjusting entry).
 *
 * BEDANYA dengan dua fitur yang sudah ada — ini pertanyaan owner, jadi
 * ditulis di sini supaya jawabannya satu tempat:
 *
 *   Edit Jurnal      : mengubah entry yang SAMA di tempatnya. Hanya boleh
 *                      untuk DRAFT manual — begitu ter-post, angkanya sudah
 *                      masuk laporan, jadi mengubahnya diam-diam menghapus
 *                      jejak. (`updateDraftJournalEntry`)
 *   Reverse Jurnal   : membatalkan entry yang sudah ter-post dengan entry
 *                      lawan bernilai SAMA PERSIS, lalu keduanya ditandai
 *                      `reversed` sehingga saling meniadakan. Dipakai kalau
 *                      jurnalnya memang tidak boleh ada. (`reverseJournalEntry`)
 *   Jurnal Penyesuaian: entry BARU berisi SELISIHNYA saja. Entry aslinya tetap
 *                      `posted` dan tetap terhitung. Dipakai kalau jurnalnya
 *                      benar tapi nilainya kurang/lebih, atau untuk penyesuaian
 *                      akhir bulan (akrual, penyusutan, dibayar di muka).
 *
 * File ini bagian murninya: hitung SELISIH dari "nilai seharusnya" yang
 * diketik owner. Tidak menyentuh DB supaya bisa dites.
 */

export type AdjustmentKind =
  | "koreksi_nilai"
  | "akrual_beban"
  | "akrual_pendapatan"
  | "beban_dibayar_dimuka"
  | "pendapatan_diterima_dimuka"
  | "penyusutan"
  | "penyesuaian_stok"
  | "lainnya";

export const ADJUSTMENT_KINDS: Array<{
  value: AdjustmentKind;
  label: string;
  help: string;
}> = [
  {
    value: "koreksi_nilai",
    label: "Koreksi Nilai",
    help: "Jurnalnya benar, nominalnya yang kurang / kelebihan. Isi selisihnya saja.",
  },
  {
    value: "akrual_beban",
    label: "Beban Masih Harus Dibayar",
    help: "Beban bulan ini yang notanya belum datang / belum dibayar (mis. listrik akhir bulan).",
  },
  {
    value: "akrual_pendapatan",
    label: "Pendapatan Masih Harus Diterima",
    help: "Pendapatan bulan ini yang uangnya belum masuk (mis. tagihan sewa ruang belum dibayar).",
  },
  {
    value: "beban_dibayar_dimuka",
    label: "Beban Dibayar di Muka",
    help: "Pembayaran untuk beberapa bulan ke depan; akui bagian bulan ini saja.",
  },
  {
    value: "pendapatan_diterima_dimuka",
    label: "Pendapatan Diterima di Muka",
    help: "Uang sudah diterima tapi jasanya belum diberikan; akui bagian bulan ini saja.",
  },
  {
    value: "penyusutan",
    label: "Penyusutan Aset",
    help: "Beban penyusutan bulanan aset tetap.",
  },
  {
    value: "penyesuaian_stok",
    label: "Penyesuaian Nilai Stok",
    help: "Selisih nilai persediaan hasil opname terhadap catatan.",
  },
  {
    value: "lainnya",
    label: "Lainnya",
    help: "Penyesuaian yang tidak masuk kategori di atas — jelaskan di kolom alasan.",
  },
];

const KIND_VALUES = new Set<string>(ADJUSTMENT_KINDS.map((k) => k.value));

export function isAdjustmentKind(v: unknown): v is AdjustmentKind {
  return typeof v === "string" && KIND_VALUES.has(v);
}

export function adjustmentKindLabel(kind: string): string {
  return ADJUSTMENT_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

/** Satu baris jurnal asli yang sedang disesuaikan. */
export type AdjustSourceLine = {
  /** journal_lines.id — dipakai sebagai kunci input "nilai seharusnya". */
  lineId: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
};

export type AdjustmentDeltaLine = {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
};

export type AdjustmentDeltaPlan = {
  /** Baris selisih, sudah dijumlahkan per akun & sisi nolnya dibuang. */
  lines: AdjustmentDeltaLine[];
  totalDebit: number;
  totalCredit: number;
  /** totalDebit - totalCredit. 0 = seimbang. */
  diff: number;
  balanced: boolean;
  /** true kalau tidak ada satupun nilai yang berubah. */
  unchanged: boolean;
};

function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed.replace(/\./g, "").replace(/,/g, "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Hitung baris SELISIH dari "nilai seharusnya" per baris jurnal asli.
 *
 * Aturan:
 *  - Sisi baris (Debit/Kredit) diambil dari baris aslinya. Owner cuma mengetik
 *    SATU angka per baris: berapa yang seharusnya.
 *  - Nilai seharusnya > sekarang → selisih ditaruh di sisi yang sama.
 *  - Nilai seharusnya < sekarang → selisih ditaruh di sisi SEBALIKNYA
 *    (itulah cara mengurangi tanpa menyentuh entry aslinya).
 *  - Baris kosong / tidak diisi = tidak berubah.
 *  - Akun yang muncul di beberapa baris dijumlahkan jadi satu baris selisih.
 *
 * Hasilnya BOLEH tidak seimbang (mis. owner baru mengoreksi satu sisi) —
 * pemanggil yang menampilkan selisihnya supaya bisa dibereskan sebelum post.
 */
export function planAdjustmentDelta(
  original: AdjustSourceLine[],
  correctedByLineId: Record<string, string | number | null | undefined>,
): AdjustmentDeltaPlan {
  /* Nilai bersih per akun: positif = perlu tambahan DEBIT, negatif = KREDIT. */
  const netByAccount = new Map<
    string,
    { accountId: string; accountCode: string; accountName: string; net: number }
  >();
  let anyChange = false;

  for (const line of original) {
    const isDebitSide = Number(line.debit) > 0;
    const current = isDebitSide ? Number(line.debit) : Number(line.credit);
    const target = parseAmount(correctedByLineId[line.lineId]);
    if (target === null) continue;
    if (target < 0) continue; // nilai negatif tidak punya arti — abaikan
    const delta = target - current;
    if (delta === 0) continue;
    anyChange = true;

    /* Sisi debit: kekurangan → tambah debit (positif). Sisi kredit: kekurangan
     * → tambah kredit, yang dalam notasi net = negatif. */
    const signed = isDebitSide ? delta : -delta;
    const prev = netByAccount.get(line.accountId);
    if (prev) {
      prev.net += signed;
    } else {
      netByAccount.set(line.accountId, {
        accountId: line.accountId,
        accountCode: line.accountCode,
        accountName: line.accountName,
        net: signed,
      });
    }
  }

  const lines: AdjustmentDeltaLine[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const row of [...netByAccount.values()].sort((a, b) =>
    a.accountCode.localeCompare(b.accountCode),
  )) {
    if (row.net === 0) continue;
    const debit = row.net > 0 ? row.net : 0;
    const credit = row.net < 0 ? -row.net : 0;
    totalDebit += debit;
    totalCredit += credit;
    lines.push({
      accountId: row.accountId,
      accountCode: row.accountCode,
      accountName: row.accountName,
      debit,
      credit,
    });
  }

  return {
    lines,
    totalDebit,
    totalCredit,
    diff: totalDebit - totalCredit,
    balanced: lines.length > 0 && totalDebit === totalCredit,
    unchanged: !anyChange,
  };
}
