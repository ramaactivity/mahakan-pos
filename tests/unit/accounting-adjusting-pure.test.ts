import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT_KINDS,
  adjustmentKindLabel,
  isAdjustmentKind,
  planAdjustmentDelta,
  type AdjustSourceLine,
} from "@/features/accounting/adjusting-pure";

/* Sesi AE-211 — Jurnal Penyesuaian: entry BARU berisi selisih, entry aslinya
 * tetap berlaku. Yang dites di sini: hitungan selisih dari "nilai seharusnya"
 * yang diketik owner. */

function line(
  lineId: string,
  accountCode: string,
  debit: number,
  credit: number,
): AdjustSourceLine {
  return {
    lineId,
    accountId: `acc-${accountCode}`,
    accountCode,
    accountName: `Akun ${accountCode}`,
    debit,
    credit,
  };
}

/** Jurnal beban listrik Rp 500rb dibayar dari bank. */
const ORIGINAL: AdjustSourceLine[] = [
  line("l1", "6202", 500_000, 0),
  line("l2", "1110", 0, 500_000),
];

describe("planAdjustmentDelta", () => {
  it("tidak ada yang diisi → tidak ada selisih", () => {
    const plan = planAdjustmentDelta(ORIGINAL, {});
    expect(plan.unchanged).toBe(true);
    expect(plan.lines).toEqual([]);
    expect(plan.balanced).toBe(false);
  });

  it("nilai seharusnya SAMA dengan sekarang → tetap tidak ada selisih", () => {
    const plan = planAdjustmentDelta(ORIGINAL, {
      l1: "500000",
      l2: "500000",
    });
    expect(plan.unchanged).toBe(true);
    expect(plan.lines).toEqual([]);
  });

  it("nilai seharusnya LEBIH KECIL → selisih pindah ke sisi sebaliknya", () => {
    // Nota ternyata Rp 450rb, bukan Rp 500rb.
    const plan = planAdjustmentDelta(ORIGINAL, {
      l1: "450000",
      l2: "450000",
    });
    expect(plan.balanced).toBe(true);
    expect(plan.diff).toBe(0);
    // Beban dikurangi → dikredit; bank ditambah balik → didebit.
    expect(plan.lines).toEqual([
      {
        accountId: "acc-1110",
        accountCode: "1110",
        accountName: "Akun 1110",
        debit: 50_000,
        credit: 0,
      },
      {
        accountId: "acc-6202",
        accountCode: "6202",
        accountName: "Akun 6202",
        debit: 0,
        credit: 50_000,
      },
    ]);
  });

  it("nilai seharusnya LEBIH BESAR → selisih tetap di sisi asalnya", () => {
    const plan = planAdjustmentDelta(ORIGINAL, {
      l1: "620000",
      l2: "620000",
    });
    expect(plan.balanced).toBe(true);
    const beban = plan.lines.find((l) => l.accountCode === "6202")!;
    const bank = plan.lines.find((l) => l.accountCode === "1110")!;
    expect(beban.debit).toBe(120_000);
    expect(bank.credit).toBe(120_000);
  });

  it("baru satu sisi dikoreksi → hasilnya sengaja TIDAK seimbang", () => {
    /* Ini kondisi yang harus terlihat di layar, bukan ditutupi: kalau cuma
     * satu sisi yang dibetulkan, jurnalnya belum sah dan owner masih harus
     * menentukan lawannya. */
    const plan = planAdjustmentDelta(ORIGINAL, { l1: "450000" });
    expect(plan.balanced).toBe(false);
    expect(plan.diff).toBe(-50_000);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toMatchObject({ accountCode: "6202", credit: 50_000 });
  });

  it("akun yang sama muncul dua kali → selisihnya dijumlahkan jadi satu baris", () => {
    const doubled: AdjustSourceLine[] = [
      line("l1", "6202", 300_000, 0),
      line("l2", "6202", 200_000, 0),
      line("l3", "1110", 0, 500_000),
    ];
    const plan = planAdjustmentDelta(doubled, {
      l1: "350000", // +50rb
      l2: "250000", // +50rb
      l3: "600000", // +100rb
    });
    expect(plan.lines).toHaveLength(2);
    const beban = plan.lines.find((l) => l.accountCode === "6202")!;
    expect(beban.debit).toBe(100_000);
    expect(plan.balanced).toBe(true);
  });

  it("dua koreksi berlawanan pada akun yang sama saling meniadakan → barisnya dibuang", () => {
    const both: AdjustSourceLine[] = [
      line("l1", "6202", 300_000, 0),
      line("l2", "6202", 200_000, 0),
    ];
    const plan = planAdjustmentDelta(both, { l1: "350000", l2: "150000" });
    expect(plan.unchanged).toBe(false);
    expect(plan.lines).toEqual([]);
  });

  it("nilai seharusnya nol → seluruh baris dikosongkan lewat sisi sebaliknya", () => {
    const plan = planAdjustmentDelta(ORIGINAL, { l1: "0", l2: "0" });
    expect(plan.balanced).toBe(true);
    expect(plan.lines.find((l) => l.accountCode === "6202")!.credit).toBe(
      500_000,
    );
    expect(plan.lines.find((l) => l.accountCode === "1110")!.debit).toBe(
      500_000,
    );
  });

  it("input kosong / bukan angka / negatif diabaikan, bukan dianggap nol", () => {
    /* Kalau string kosong dibaca sebagai 0, membiarkan satu kolom kosong akan
     * diam-diam menghapus baris jurnalnya. */
    expect(planAdjustmentDelta(ORIGINAL, { l1: "", l2: "  " }).unchanged).toBe(
      true,
    );
    expect(planAdjustmentDelta(ORIGINAL, { l1: "abc" }).unchanged).toBe(true);
    expect(planAdjustmentDelta(ORIGINAL, { l1: "-100" }).unchanged).toBe(true);
    expect(
      planAdjustmentDelta(ORIGINAL, { l1: null, l2: undefined }).unchanged,
    ).toBe(true);
  });

  it("angka berformat ribuan id-ID tetap terbaca", () => {
    const plan = planAdjustmentDelta(ORIGINAL, { l1: "450.000" });
    expect(plan.lines[0]).toMatchObject({ accountCode: "6202", credit: 50_000 });
  });

  it("baris hasil diurutkan per kode akun supaya jurnalnya stabil", () => {
    const plan = planAdjustmentDelta(ORIGINAL, {
      l1: "450000",
      l2: "450000",
    });
    expect(plan.lines.map((l) => l.accountCode)).toEqual(["1110", "6202"]);
  });
});

describe("jenis penyesuaian", () => {
  it("semua jenis punya label & penjelasan", () => {
    for (const k of ADJUSTMENT_KINDS) {
      expect(k.label.length).toBeGreaterThan(0);
      expect(k.help.length).toBeGreaterThan(0);
      expect(isAdjustmentKind(k.value)).toBe(true);
    }
  });

  it("jenis asing ditolak (server memakai ini sebagai validasi)", () => {
    expect(isAdjustmentKind("reversal")).toBe(false);
    expect(isAdjustmentKind("")).toBe(false);
    expect(isAdjustmentKind(null)).toBe(false);
  });

  it("label balik ke nilai mentah kalau jenisnya tidak dikenal", () => {
    expect(adjustmentKindLabel("penyusutan")).toBe("Penyusutan Aset");
    expect(adjustmentKindLabel("entah")).toBe("entah");
  });
});
