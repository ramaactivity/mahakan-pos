import { describe, expect, it } from "vitest";
import { subtractAlreadyMoved } from "@/features/finance/settlement-reclass-pure";

/* Sesi AE-246 — kejadian nyata yang hampir terjadi: QRIS Mei–Juli SUDAH
 * dipindah dari 1110 ke 1113 (Rp 45,6 jt), Agustus belum. Kalau owner memilih
 * rentang Mei–Agustus untuk mengejar Agustus, tanpa pengurangan ini Mei–Juli
 * ikut dipindah SEKALI LAGI — jurnalnya tetap seimbang, jadi tidak ada yang
 * terlihat rusak sampai rekening koran dicocokkan. */
const prod = [
  { month: "2026-05", code: "1110", amount: 12_116_586 },
  { month: "2026-06", code: "1110", amount: 17_529_429 },
  { month: "2026-07", code: "1110", amount: 16_012_125 },
  { month: "2026-08", code: "1110", amount: 14_864_217 },
];

describe("subtractAlreadyMoved (AE-246)", () => {
  it("bulan yang sudah pindah penuh HILANG dari daftar", () => {
    const moved = new Map([
      ["2026-05|1110", 12_116_586],
      ["2026-06|1110", 17_529_429],
      ["2026-07|1110", 16_012_125],
    ]);
    const out = subtractAlreadyMoved(prod, moved);
    expect(out).toHaveLength(1);
    expect(out[0]!.month).toBe("2026-08");
    expect(out[0]!.amount).toBe(14_864_217);
  });

  it("tanpa riwayat pindah, semuanya tetap utuh", () => {
    const out = subtractAlreadyMoved(prod, new Map());
    expect(out).toHaveLength(4);
    expect(out.reduce((s, r) => s + r.amount, 0)).toBe(60_522_357);
  });

  it("pindah SEBAGIAN menyisakan selisihnya saja", () => {
    const out = subtractAlreadyMoved(prod, new Map([["2026-08|1110", 4_864_217]]));
    expect(out.find((r) => r.month === "2026-08")!.amount).toBe(10_000_000);
  });

  it("pindah berlebih tidak pernah jadi nilai minus", () => {
    const out = subtractAlreadyMoved(
      [{ month: "2026-08", code: "1110", amount: 100_000 }],
      new Map([["2026-08|1110", 250_000]]),
    );
    expect(out).toHaveLength(0);
  });

  it("riwayat pindah dari rekening LAIN tidak ikut mengurangi", () => {
    const out = subtractAlreadyMoved(prod, new Map([["2026-08|1112", 14_864_217]]));
    expect(out.find((r) => r.month === "2026-08")!.amount).toBe(14_864_217);
  });
});

/* Sesi AE-249 — rantai pemindahan. QRIS September benar-benar dipindah dua
 * kali: 1110 → 1113 (Agustus, aturan channel) lalu 1113 → 1112. Titik
 * berangkat revisi harus mengikuti rantai itu sampai ujung; kalau berhenti di
 * lompatan pertama, revisi akan memindahkan uang yang sudah pindah. */
function followReclassChain(
  startCode: string,
  hops: Map<string, string>,
  maxHops = 5,
): string {
  let code = startCode;
  for (let i = 0; i < maxHops; i += 1) {
    const next = hops.get(code);
    if (!next || next === code) break;
    code = next;
  }
  return code;
}

describe("rantai Pindah Rekening (AE-249)", () => {
  it("satu lompatan", () => {
    expect(followReclassChain("1110", new Map([["1110", "1113"]]))).toBe("1113");
  });

  it("dua lompatan — kasus QRIS September", () => {
    const hops = new Map([
      ["1110", "1113"],
      ["1113", "1112"],
    ]);
    expect(followReclassChain("1110", hops)).toBe("1112");
  });

  it("tanpa pemindahan, tetap di rekening aslinya", () => {
    expect(followReclassChain("1113", new Map())).toBe("1113");
  });

  it("data melingkar tidak menggantung", () => {
    const hops = new Map([
      ["1110", "1113"],
      ["1113", "1110"],
    ]);
    // berhenti di batas lompatan, bukan berputar selamanya
    expect(["1110", "1113"]).toContain(followReclassChain("1110", hops));
  });
});
