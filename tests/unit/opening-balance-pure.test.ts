import { describe, expect, it } from "vitest";
import {
  OpeningBalanceError,
  RETAINED_EARNINGS_CODE,
  buildOpeningBalanceLines,
  linesToNaturalAmounts,
  type OpeningAccountInput,
} from "@/features/accounting/opening-balance-pure";

const RETAINED_ID = "acc-3301";

function acc(
  code: string,
  normalBalance: "debit" | "credit",
  amount: number,
): OpeningAccountInput {
  return { accountId: `acc-${code}`, code, normalBalance, amount };
}

/**
 * Yang dijaga tes ini: owner mengetik NILAI RIIL positif dan TIDAK BISA
 * menghasilkan neraca yang tidak seimbang, apa pun yang dia isi.
 */
describe("buildOpeningBalanceLines — selalu seimbang", () => {
  it("aset > kewajiban+modal → selisih jadi KREDIT di 3301 (akumulasi laba)", () => {
    const r = buildOpeningBalanceLines(
      [acc("1101", "debit", 10_000_000), acc("2101", "credit", 3_000_000)],
      RETAINED_ID,
    );
    expect(r.totalDebit).toBe(r.totalCredit);
    expect(r.totalDebit).toBe(10_000_000);
    expect(r.retainedPlug).toBe(-7_000_000);
    const plug = r.lines.find((l) => l.accountId === RETAINED_ID)!;
    expect(plug.credit).toBe(7_000_000);
    expect(plug.debit).toBe(0);
  });

  it("kewajiban+modal > aset → selisih jadi DEBIT di 3301 (akumulasi kerugian)", () => {
    // Kondisi Mahakan per 1 Juli: hutang jauh lebih besar dari aset.
    const r = buildOpeningBalanceLines(
      [
        acc("1101", "debit", 11_222_301),
        acc("2150", "credit", 24_900_000),
        acc("2170", "credit", 41_833_329),
      ],
      RETAINED_ID,
    );
    expect(r.totalDebit).toBe(r.totalCredit);
    expect(r.retainedPlug).toBe(55_511_028);
    const plug = r.lines.find((l) => l.accountId === RETAINED_ID)!;
    expect(plug.debit).toBe(55_511_028);
    expect(plug.credit).toBe(0);
  });

  it("sudah seimbang tanpa plug → tidak ada baris 3301", () => {
    const r = buildOpeningBalanceLines(
      [acc("1101", "debit", 5_000_000), acc("3101", "credit", 5_000_000)],
      RETAINED_ID,
    );
    expect(r.retainedPlug).toBe(0);
    expect(r.lines.some((l) => l.accountId === RETAINED_ID)).toBe(false);
    expect(r.lines).toHaveLength(2);
  });

  it("akun contra dihormati arah normalnya (Akum. Penyusutan = kredit)", () => {
    const r = buildOpeningBalanceLines(
      [acc("1202", "debit", 7_000_000), acc("1290", "credit", 83_333)],
      RETAINED_ID,
    );
    const akum = r.lines.find((l) => l.accountId === "acc-1290")!;
    expect(akum.credit).toBe(83_333);
    expect(r.totalDebit).toBe(r.totalCredit);
  });

  it("akun bernilai 0 tidak menghasilkan baris", () => {
    const r = buildOpeningBalanceLines(
      [
        acc("1101", "debit", 1_000_000),
        acc("1102", "debit", 0),
        acc("2101", "credit", 400_000),
      ],
      RETAINED_ID,
    );
    expect(r.lines.some((l) => l.accountId === "acc-1102")).toBe(false);
  });

  it("banyak akun campur tetap seimbang", () => {
    const r = buildOpeningBalanceLines(
      [
        acc("1101", "debit", 11_222_301),
        acc("1110", "debit", 1_622_113),
        acc("1111", "debit", 8_733_997),
        acc("1113", "debit", 2_265_880),
        acc("1140", "debit", 4_943_843),
        acc("1141", "debit", 2_968_801),
        acc("1202", "debit", 7_000_000),
        acc("1290", "credit", 83_333),
        acc("2101", "credit", 930_000),
        acc("2150", "credit", 24_900_000),
        acc("2170", "credit", 41_833_329),
        acc("3101", "credit", 77_750_000),
      ],
      RETAINED_ID,
    );
    expect(r.totalDebit).toBe(r.totalCredit);
    const plug = r.lines.find((l) => l.accountId === RETAINED_ID)!;
    // Ekuitas dipaksa positif Rp77,75jt → defisit terakumulasi di 3301.
    expect(plug.debit).toBeGreaterThan(0);
  });
});

describe("buildOpeningBalanceLines — nilai MINUS", () => {
  /* Bukan kasus teoretis: saldo produksi per 1 Juli punya 3101 Modal Owner
   * = −Rp11.700.000. Kalau minus ditolak, form Ubah Saldo Awal bahkan tidak
   * bisa menyimpan kembali kondisi yang sedang berlaku. */
  it("akun kredit bersaldo minus mendarat di sisi DEBIT", () => {
    const r = buildOpeningBalanceLines(
      [acc("1101", "debit", 5_000_000), acc("3101", "credit", -11_700_000)],
      RETAINED_ID,
    );
    const modal = r.lines.find((l) => l.accountId === "acc-3101")!;
    expect(modal.debit).toBe(11_700_000);
    expect(modal.credit).toBe(0);
    expect(r.totalDebit).toBe(r.totalCredit);
  });

  it("akun debit bersaldo minus mendarat di sisi KREDIT", () => {
    const r = buildOpeningBalanceLines(
      [acc("1142", "debit", -3_097_799), acc("2101", "credit", 1_000_000)],
      RETAINED_ID,
    );
    const persediaan = r.lines.find((l) => l.accountId === "acc-1142")!;
    expect(persediaan.credit).toBe(3_097_799);
    expect(persediaan.debit).toBe(0);
    expect(r.totalDebit).toBe(r.totalCredit);
  });

  it("saldo awal produksi 1 Juli (termasuk 3101 minus) bisa disusun ulang utuh", () => {
    const inputs = [
      acc("1101", "debit", 11_222_301),
      acc("1110", "debit", 1_622_113),
      acc("1111", "debit", 8_733_997),
      acc("1113", "debit", 2_265_880),
      acc("1140", "debit", 4_943_843),
      acc("1141", "debit", 2_968_801),
      acc("1202", "debit", 7_000_000),
      acc("1290", "credit", 83_333),
      acc("2101", "credit", 930_000),
      acc("2150", "credit", 24_900_000),
      acc("2170", "credit", 41_833_329),
      acc("3101", "credit", -11_700_000),
    ];
    const r = buildOpeningBalanceLines(inputs, RETAINED_ID);
    expect(r.totalDebit).toBe(r.totalCredit);
    expect(r.totalDebit).toBe(67_746_662); // sama dengan JE-202607-0758
    const plug = r.lines.find((l) => l.accountId === RETAINED_ID)!;
    expect(plug.debit).toBe(17_289_727);
  });

  it("bolak-balik minus: build → read mengembalikan angka minus yang sama", () => {
    const inputs = [
      acc("1101", "debit", 5_000_000),
      acc("3101", "credit", -11_700_000),
    ];
    const built = buildOpeningBalanceLines(inputs, RETAINED_ID);
    const normalById = new Map<string, "debit" | "credit">([
      ["acc-1101", "debit"],
      ["acc-3101", "credit"],
      [RETAINED_ID, "credit"],
    ]);
    const back = linesToNaturalAmounts(
      built.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        normalBalance: normalById.get(l.accountId)!,
      })),
    );
    expect(back.get("acc-1101")).toBe(5_000_000);
    expect(back.get("acc-3101")).toBe(-11_700_000);
  });
});

describe("buildOpeningBalanceLines — penolakan", () => {
  it("menolak 3301 diisi manual (kalau tidak, selisihnya dobel)", () => {
    expect(() =>
      buildOpeningBalanceLines(
        [
          acc("1101", "debit", 1_000_000),
          acc(RETAINED_EARNINGS_CODE, "credit", 500_000),
        ],
        RETAINED_ID,
      ),
    ).toThrow(OpeningBalanceError);
  });

  it("menolak angka pecahan", () => {
    expect(() =>
      buildOpeningBalanceLines(
        [acc("1101", "debit", 1_000.5), acc("2101", "credit", 1_000)],
        RETAINED_ID,
      ),
    ).toThrow(/bulat/);
  });

  it("menolak akun terisi dua kali", () => {
    const dup = acc("1101", "debit", 1_000);
    expect(() => buildOpeningBalanceLines([dup, dup], RETAINED_ID)).toThrow(
      /dua kali/,
    );
  });

  it("menolak kalau akun 3301 tidak ada di COA", () => {
    expect(() =>
      buildOpeningBalanceLines([acc("1101", "debit", 1_000_000)], ""),
    ).toThrow(/tidak ada di Bagan Akun/);
  });

  it("menolak kalau hasilnya kurang dari 2 baris", () => {
    // Satu akun saja: plug bikin 2 baris, jadi ini justru SAH.
    const r = buildOpeningBalanceLines(
      [acc("1101", "debit", 1_000_000)],
      RETAINED_ID,
    );
    expect(r.lines).toHaveLength(2);
    // Tapi semua nol → tidak ada baris sama sekali → ditolak.
    expect(() =>
      buildOpeningBalanceLines([acc("1101", "debit", 0)], RETAINED_ID),
    ).toThrow(/minimal 2 akun/);
  });
});

describe("linesToNaturalAmounts — kebalikan dari build", () => {
  it("mengubah debit/kredit tersimpan kembali ke nilai riil", () => {
    const m = linesToNaturalAmounts([
      { accountId: "a", debit: 1_000_000, credit: 0, normalBalance: "debit" },
      { accountId: "b", debit: 0, credit: 400_000, normalBalance: "credit" },
    ]);
    expect(m.get("a")).toBe(1_000_000);
    expect(m.get("b")).toBe(400_000);
  });

  it("akun dengan saldo berlawanan arah normal jadi negatif (mis. 1142 minus)", () => {
    const m = linesToNaturalAmounts([
      { accountId: "c", debit: 0, credit: 3_097_799, normalBalance: "debit" },
    ]);
    expect(m.get("c")).toBe(-3_097_799);
  });

  it("bolak-balik build → read menghasilkan angka yang sama", () => {
    const inputs = [
      acc("1101", "debit", 11_222_301),
      acc("2170", "credit", 41_833_329),
    ];
    const built = buildOpeningBalanceLines(inputs, RETAINED_ID);
    const back = linesToNaturalAmounts(
      built.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        normalBalance:
          l.accountId === "acc-1101"
            ? ("debit" as const)
            : l.accountId === "acc-2170"
              ? ("credit" as const)
              : ("credit" as const),
      })),
    );
    expect(back.get("acc-1101")).toBe(11_222_301);
    expect(back.get("acc-2170")).toBe(41_833_329);
  });

  it("nilai string dari DB (numeric) tetap terbaca", () => {
    const m = linesToNaturalAmounts([
      { accountId: "a", debit: "2500", credit: "0", normalBalance: "debit" },
    ]);
    expect(m.get("a")).toBe(2500);
  });
});
