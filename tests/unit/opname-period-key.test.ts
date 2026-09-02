import { describe, expect, it } from "vitest";
import {
  monthKeyToLabel,
  suggestedOpnamePeriodKey,
} from "@/features/stock-opname/cadence";

/* Sesi AE-230 — opname stok akhir Agustus 2026 dihitung 1 September sore,
 * lalu tercatat sebagai opname September: rekap COGS Agustus kosong (HPP Rp 0,
 * 159 baris "perlu dicek") sementara September memuat pemakaian sebulan penuh
 * yang bukan miliknya. */
describe("suggestedOpnamePeriodKey", () => {
  const wib = (iso: string) => new Date(`${iso}+07:00`);

  it("hitungan di awal bulan menutup BULAN SEBELUMNYA", () => {
    expect(suggestedOpnamePeriodKey(wib("2026-09-01T15:56:00"))).toBe("2026-08");
    expect(suggestedOpnamePeriodKey(wib("2026-09-05T09:00:00"))).toBe("2026-08");
  });

  it("lewat masa tenggang, kembali ke bulan berjalan", () => {
    expect(suggestedOpnamePeriodKey(wib("2026-09-06T09:00:00"))).toBe("2026-09");
    expect(suggestedOpnamePeriodKey(wib("2026-09-30T21:00:00"))).toBe("2026-09");
  });

  it("hitungan di hari terakhir bulan tetap bulan itu sendiri", () => {
    expect(suggestedOpnamePeriodKey(wib("2026-07-31T20:58:00"))).toBe("2026-07");
  });

  it("awal Januari mundur ke Desember tahun sebelumnya", () => {
    expect(suggestedOpnamePeriodKey(wib("2027-01-02T08:00:00"))).toBe("2026-12");
  });

  it("memakai kalender WIB, bukan UTC", () => {
    /* 1 Sep 2026 00:30 WIB = 31 Agu 17:30 UTC — tetap dianggap awal
     * September (dan karenanya menutup Agustus). */
    expect(suggestedOpnamePeriodKey(wib("2026-09-01T00:30:00"))).toBe("2026-08");
  });
});

describe("monthKeyToLabel", () => {
  it("menerjemahkan ke nama bulan Indonesia", () => {
    expect(monthKeyToLabel("2026-08")).toBe("Agustus 2026");
    expect(monthKeyToLabel("2026-01")).toBe("Januari 2026");
  });
  it("mengembalikan apa adanya kalau bukan kunci bulan", () => {
    expect(monthKeyToLabel("bukan-bulan")).toBe("bukan-bulan");
  });
});
