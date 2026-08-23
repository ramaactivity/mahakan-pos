import { describe, expect, it } from "vitest";
import {
  ACC_ACCUM_IMPAIRMENT,
  ACC_IMPAIRMENT_LOSS,
  ACC_IMPAIRMENT_RECOVERY,
  ACC_REVALUATION_LOSS,
  ACC_REVALUATION_SURPLUS,
  carryingAmountOf,
  planAssetValuation,
  type AssetValuationState,
} from "@/features/accounting/fixed-asset-valuation-pure";

/**
 * Sesi AE-214 — aturan yang dijaga:
 *
 *   1. Kenaikan revaluasi masuk EKUITAS, bukan laba — kecuali sebatas rugi
 *      revaluasi yang pernah dibebankan ke laba rugi untuk aset yang sama.
 *   2. Penurunan revaluasi menggerus surplus aset itu DULU, sisanya baru rugi.
 *   3. Penurunan nilai (impairment) langsung jadi rugi, lawannya kontra-aset.
 *   4. Pemulihan dibatasi sebesar penurunan yang pernah diakui.
 *   5. Setiap jurnal yang dihasilkan SEIMBANG. Kalau yang ini jebol, jurnal
 *      tidak seimbang akan sampai ke `recordJournal` dan gagal di sana sebagai
 *      error teknis yang tidak bisa dibaca owner.
 */

function stateOf(over: Partial<AssetValuationState> = {}): AssetValuationState {
  return {
    assetName: "Mesin Espresso",
    assetAccountCode: "1202",
    accumulatedDepreciationAccountCode: "1290",
    grossAmount: 100_000_000,
    accumulatedDepreciation: 40_000_000,
    accumulatedImpairment: 0,
    revaluationSurplus: 0,
    revaluationLossRecognized: 0,
    salvageValue: 0,
    ...over,
  };
}

function totals(lines: Array<{ debit?: number; credit?: number }>) {
  return {
    debit: lines.reduce((s, l) => s + (l.debit ?? 0), 0),
    credit: lines.reduce((s, l) => s + (l.credit ?? 0), 0),
  };
}

function sideOf(
  lines: Array<{ accountCode: string; debit?: number; credit?: number }>,
  code: string,
) {
  const hit = lines.filter((l) => l.accountCode === code);
  return {
    debit: hit.reduce((s, l) => s + (l.debit ?? 0), 0),
    credit: hit.reduce((s, l) => s + (l.credit ?? 0), 0),
  };
}

describe("carryingAmountOf", () => {
  it("nilai tercatat = bruto − akum penyusutan − akum penurunan nilai", () => {
    expect(
      carryingAmountOf({
        grossAmount: 100_000_000,
        accumulatedDepreciation: 40_000_000,
        accumulatedImpairment: 10_000_000,
      }),
    ).toBe(50_000_000);
  });
});

describe("revaluasi NAIK", () => {
  const state = stateOf();
  const plan = planAssetValuation(state, {
    kind: "revaluation",
    newCarrying: 75_000_000,
    remainingLifeMonths: 24,
  });

  it("berhasil dan jurnalnya seimbang", () => {
    expect(plan.ok).toBe(true);
    const t = totals(plan.lines);
    expect(t.debit).toBe(t.credit);
  });

  it("mengeliminasi akumulasi penyusutan ke nilai bruto", () => {
    expect(plan.accumDepEliminated).toBe(40_000_000);
    expect(sideOf(plan.lines, "1290").debit).toBe(40_000_000);
  });

  it("kenaikan Rp 15jt seluruhnya masuk ekuitas, bukan laba", () => {
    expect(plan.carryingBefore).toBe(60_000_000);
    expect(plan.delta).toBe(15_000_000);
    expect(plan.surplusCredit).toBe(15_000_000);
    expect(plan.plGain).toBe(0);
    expect(sideOf(plan.lines, ACC_REVALUATION_SURPLUS).credit).toBe(15_000_000);
  });

  it("keadaan sesudahnya: bruto = nilai baru, akumulasi nol", () => {
    expect(plan.nextState).not.toBeNull();
    expect(plan.nextState!.grossAmount).toBe(75_000_000);
    expect(plan.nextState!.accumulatedDepreciation).toBe(0);
    expect(plan.nextState!.accumulatedImpairment).toBe(0);
    expect(plan.nextState!.revaluationSurplus).toBe(15_000_000);
    expect(plan.nextState!.basisAmount).toBe(75_000_000);
    expect(plan.nextState!.basisRemainingMonths).toBe(24);
  });
});

describe("revaluasi NAIK setelah pernah rugi revaluasi", () => {
  /* Rugi Rp 5jt pernah dibebankan ke laba rugi. Kenaikan berikutnya harus
   * memulihkan rugi itu DULU (lewat laba rugi), sisanya baru ke ekuitas. */
  const plan = planAssetValuation(
    stateOf({ revaluationLossRecognized: 5_000_000 }),
    { kind: "revaluation", newCarrying: 68_000_000, remainingLifeMonths: 12 },
  );

  it("Rp 5jt pertama jadi pendapatan, sisanya Rp 3jt jadi surplus", () => {
    expect(plan.delta).toBe(8_000_000);
    expect(plan.plGain).toBe(5_000_000);
    expect(plan.surplusCredit).toBe(3_000_000);
    expect(sideOf(plan.lines, ACC_IMPAIRMENT_RECOVERY).credit).toBe(5_000_000);
    expect(sideOf(plan.lines, ACC_REVALUATION_SURPLUS).credit).toBe(3_000_000);
  });

  it("rugi yang tercatat habis, tidak bisa dipulihkan dua kali", () => {
    expect(plan.nextState!.revaluationLossRecognized).toBe(0);
  });

  it("jurnalnya seimbang", () => {
    const t = totals(plan.lines);
    expect(t.debit).toBe(t.credit);
  });
});

describe("revaluasi TURUN", () => {
  it("menggerus surplus aset itu dulu, sisanya jadi rugi", () => {
    const plan = planAssetValuation(
      stateOf({ revaluationSurplus: 4_000_000 }),
      { kind: "revaluation", newCarrying: 50_000_000, remainingLifeMonths: 12 },
    );
    expect(plan.delta).toBe(-10_000_000);
    expect(plan.surplusDebit).toBe(4_000_000);
    expect(plan.plLoss).toBe(6_000_000);
    expect(sideOf(plan.lines, ACC_REVALUATION_SURPLUS).debit).toBe(4_000_000);
    expect(sideOf(plan.lines, ACC_REVALUATION_LOSS).debit).toBe(6_000_000);
    expect(plan.nextState!.revaluationSurplus).toBe(0);
    expect(plan.nextState!.revaluationLossRecognized).toBe(6_000_000);
    const t = totals(plan.lines);
    expect(t.debit).toBe(t.credit);
  });

  it("tanpa surplus, seluruhnya jadi rugi di laba rugi", () => {
    const plan = planAssetValuation(stateOf(), {
      kind: "revaluation",
      newCarrying: 55_000_000,
      remainingLifeMonths: 12,
    });
    expect(plan.surplusDebit).toBe(0);
    expect(plan.plLoss).toBe(5_000_000);
    expect(sideOf(plan.lines, ACC_REVALUATION_LOSS).debit).toBe(5_000_000);
  });

  it("nilai yang sama persis ditolak — tidak ada yang perlu dijurnal", () => {
    const plan = planAssetValuation(stateOf(), {
      kind: "revaluation",
      newCarrying: 60_000_000,
      remainingLifeMonths: 12,
    });
    expect(plan.ok).toBe(false);
    expect(plan.errors[0]).toContain("sama dengan nilai tercatat");
  });
});

describe("penurunan nilai (impairment)", () => {
  const plan = planAssetValuation(stateOf(), {
    kind: "impairment",
    newCarrying: 35_000_000,
    remainingLifeMonths: 18,
  });

  it("langsung jadi rugi, lawannya kontra-aset 1291", () => {
    expect(plan.ok).toBe(true);
    expect(plan.plLoss).toBe(25_000_000);
    expect(sideOf(plan.lines, ACC_IMPAIRMENT_LOSS).debit).toBe(25_000_000);
    expect(sideOf(plan.lines, ACC_ACCUM_IMPAIRMENT).credit).toBe(25_000_000);
  });

  it("TIDAK menyentuh nilai bruto maupun akumulasi penyusutan", () => {
    expect(plan.nextState!.grossAmount).toBe(100_000_000);
    expect(plan.nextState!.accumulatedDepreciation).toBe(40_000_000);
    expect(plan.nextState!.accumulatedImpairment).toBe(25_000_000);
    expect(plan.accumDepEliminated).toBe(0);
  });

  it("basis penyusutan berikutnya = nilai tercatat baru", () => {
    expect(plan.nextState!.basisAmount).toBe(35_000_000);
    expect(plan.nextState!.basisRemainingMonths).toBe(18);
  });

  it("ditolak kalau nilainya justru naik", () => {
    const naik = planAssetValuation(stateOf(), {
      kind: "impairment",
      newCarrying: 70_000_000,
      remainingLifeMonths: 12,
    });
    expect(naik.ok).toBe(false);
    expect(naik.errors[0]).toContain("LEBIH KECIL");
  });
});

describe("pemulihan penurunan nilai", () => {
  const impaired = stateOf({
    accumulatedDepreciation: 40_000_000,
    accumulatedImpairment: 25_000_000,
  });

  it("dibatasi sebesar penurunan yang pernah diakui", () => {
    /* Nilai tercatat sekarang 35jt; pemulihan maksimal +25jt → 60jt. */
    const tembus = planAssetValuation(impaired, {
      kind: "impairment_reversal",
      newCarrying: 61_000_000,
      remainingLifeMonths: 12,
    });
    expect(tembus.ok).toBe(false);
    expect(tembus.errors[0]).toContain("Pemulihan maksimal");
  });

  it("pemulihan sebagian mengurangi akumulasi penurunan nilai", () => {
    const plan = planAssetValuation(impaired, {
      kind: "impairment_reversal",
      newCarrying: 45_000_000,
      remainingLifeMonths: 12,
    });
    expect(plan.ok).toBe(true);
    expect(plan.plGain).toBe(10_000_000);
    expect(sideOf(plan.lines, ACC_ACCUM_IMPAIRMENT).debit).toBe(10_000_000);
    expect(sideOf(plan.lines, ACC_IMPAIRMENT_RECOVERY).credit).toBe(10_000_000);
    expect(plan.nextState!.accumulatedImpairment).toBe(15_000_000);
    const t = totals(plan.lines);
    expect(t.debit).toBe(t.credit);
  });

  it("ditolak kalau aset belum pernah turun nilai", () => {
    const plan = planAssetValuation(stateOf(), {
      kind: "impairment_reversal",
      newCarrying: 70_000_000,
      remainingLifeMonths: 12,
    });
    expect(plan.ok).toBe(false);
    expect(plan.errors[0]).toContain("belum pernah diturunkan");
  });
});

describe("revaluasi aset yang pernah turun nilai", () => {
  it("mengeliminasi akumulasi penyusutan DAN akumulasi penurunan nilai", () => {
    const plan = planAssetValuation(
      stateOf({ accumulatedImpairment: 10_000_000 }),
      { kind: "revaluation", newCarrying: 60_000_000, remainingLifeMonths: 12 },
    );
    expect(plan.carryingBefore).toBe(50_000_000);
    expect(plan.accumDepEliminated).toBe(40_000_000);
    expect(plan.accumImpairmentEliminated).toBe(10_000_000);
    expect(sideOf(plan.lines, ACC_ACCUM_IMPAIRMENT).debit).toBe(10_000_000);
    /* Bruto turun 50jt (eliminasi) lalu naik 10jt (selisih revaluasi). */
    expect(sideOf(plan.lines, "1202").credit).toBe(50_000_000);
    expect(sideOf(plan.lines, "1202").debit).toBe(10_000_000);
    expect(plan.nextState!.accumulatedImpairment).toBe(0);
    const t = totals(plan.lines);
    expect(t.debit).toBe(t.credit);
  });
});

describe("penjagaan masukan", () => {
  it("menolak nilai negatif", () => {
    const plan = planAssetValuation(stateOf(), {
      kind: "revaluation",
      newCarrying: -1,
      remainingLifeMonths: 12,
    });
    expect(plan.ok).toBe(false);
  });

  it("menolak sisa umur di luar 1-600 bulan", () => {
    expect(
      planAssetValuation(stateOf(), {
        kind: "revaluation",
        newCarrying: 70_000_000,
        remainingLifeMonths: 0,
      }).ok,
    ).toBe(false);
    expect(
      planAssetValuation(stateOf(), {
        kind: "revaluation",
        newCarrying: 70_000_000,
        remainingLifeMonths: 601,
      }).ok,
    ).toBe(false);
  });

  it("memperingatkan kalau nilai barunya di bawah nilai sisa", () => {
    const plan = planAssetValuation(stateOf({ salvageValue: 30_000_000 }), {
      kind: "impairment",
      newCarrying: 20_000_000,
      remainingLifeMonths: 12,
    });
    expect(plan.ok).toBe(true);
    expect(plan.warnings.join(" ")).toContain("berhenti disusutkan");
  });

  it("mengingatkan bahwa revaluasi berlaku satu KELAS aset", () => {
    const plan = planAssetValuation(stateOf(), {
      kind: "revaluation",
      newCarrying: 70_000_000,
      remainingLifeMonths: 12,
    });
    expect(plan.warnings.join(" ")).toContain("KELAS");
  });
});
