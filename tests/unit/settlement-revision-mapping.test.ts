import { describe, expect, it } from "vitest";
import {
  ACCOUNT_MDR,
  mapSettlementRevision,
  reverseSettlementRevisionLines,
} from "@/features/accounting/mapping/settlementRevision";

/* Sesi AE-246 — yang gampang salah di sini: selisihnya nyangkut jadi jurnal
 * timpang, atau uang yang masuk lebih besar dicatat sebagai pendapatan baru
 * sehingga omzet mengembang tanpa ada penjualan. */
const sum = (lines: ReturnType<typeof mapSettlementRevision>) => ({
  debit: lines.reduce((s, l) => s + (l.debit ?? 0), 0),
  credit: lines.reduce((s, l) => s + (l.credit ?? 0), 0),
});
const base = {
  recordedAmount: 641_478,
  recordedAccountCode: "1110",
  label: "QRIS 2026-08-01",
};

describe("mapSettlementRevision", () => {
  it("pindah rekening + uang masuk LEBIH KECIL", () => {
    const l = mapSettlementRevision({
      ...base,
      actualAmount: 600_000,
      actualAccountCode: "1113",
    });
    expect(l.find((x) => x.accountCode === "1113")!.debit).toBe(600_000);
    expect(l.find((x) => x.accountCode === "1110")!.credit).toBe(641_478);
    expect(l.find((x) => x.accountCode === ACCOUNT_MDR)!.debit).toBe(41_478);
    const t = sum(l);
    expect(t.debit).toBe(t.credit);
  });

  it("pindah rekening + uang masuk LEBIH BESAR → MDR DIKREDIT, bukan jadi omzet", () => {
    const l = mapSettlementRevision({
      ...base,
      actualAmount: 650_000,
      actualAccountCode: "1113",
    });
    expect(l.find((x) => x.accountCode === "1113")!.debit).toBe(650_000);
    expect(l.find((x) => x.accountCode === ACCOUNT_MDR)!.credit).toBe(8_522);
    // tidak boleh ada akun pendapatan (4xxx) tersentuh
    expect(l.some((x) => x.accountCode?.startsWith("4"))).toBe(false);
    const t = sum(l);
    expect(t.debit).toBe(t.credit);
  });

  it("pindah rekening, nilainya sama persis", () => {
    const l = mapSettlementRevision({
      ...base,
      actualAmount: 641_478,
      actualAccountCode: "1113",
    });
    expect(l).toHaveLength(2);
    expect(l.find((x) => x.accountCode === "1113")!.debit).toBe(641_478);
    expect(l.find((x) => x.accountCode === "1110")!.credit).toBe(641_478);
  });

  it("rekening SAMA, cuma nilainya kurang → cukup selisihnya, tanpa baris saling meniadakan", () => {
    const l = mapSettlementRevision({
      ...base,
      actualAmount: 600_000,
      actualAccountCode: "1110",
    });
    expect(l).toHaveLength(2);
    expect(l.find((x) => x.accountCode === "1110")!.credit).toBe(41_478);
    expect(l.find((x) => x.accountCode === ACCOUNT_MDR)!.debit).toBe(41_478);
  });

  it("rekening SAMA, nilainya lebih → MDR berkurang", () => {
    const l = mapSettlementRevision({
      ...base,
      actualAmount: 700_000,
      actualAccountCode: "1110",
    });
    expect(l.find((x) => x.accountCode === "1110")!.debit).toBe(58_522);
    expect(l.find((x) => x.accountCode === ACCOUNT_MDR)!.credit).toBe(58_522);
  });

  it("uang tidak masuk sama sekali (settlement gagal)", () => {
    const l = mapSettlementRevision({
      ...base,
      actualAmount: 0,
      actualAccountCode: "1113",
    });
    expect(l.some((x) => x.accountCode === "1113")).toBe(false);
    expect(l.find((x) => x.accountCode === ACCOUNT_MDR)!.debit).toBe(641_478);
    expect(l.find((x) => x.accountCode === "1110")!.credit).toBe(641_478);
    const t = sum(l);
    expect(t.debit).toBe(t.credit);
  });

  it("tidak ada yang berubah DITOLAK, bukan jurnal kosong", () => {
    expect(() =>
      mapSettlementRevision({
        ...base,
        actualAmount: 641_478,
        actualAccountCode: "1110",
      }),
    ).toThrow(/NO_CHANGE/);
  });

  it("nilai tercatat nol/minus ditolak", () => {
    expect(() =>
      mapSettlementRevision({
        ...base,
        recordedAmount: 0,
        actualAmount: 10_000,
        actualAccountCode: "1113",
      }),
    ).toThrow(/RECORDED_NONPOSITIVE/);
  });

  it("pembalik seimbang dan menukar sisi", () => {
    const l = mapSettlementRevision({
      ...base,
      actualAmount: 600_000,
      actualAccountCode: "1113",
    });
    const rev = reverseSettlementRevisionLines(l);
    expect(rev.find((x) => x.accountCode === "1113")!.credit).toBe(600_000);
    expect(rev.find((x) => x.accountCode === "1110")!.debit).toBe(641_478);
    const t = sum(rev);
    expect(t.debit).toBe(t.credit);
  });
});
