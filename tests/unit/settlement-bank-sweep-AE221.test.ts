import { describe, expect, it } from "vitest";
import {
  defaultBankCodeForChannel,
  resolveSettlementBankCode,
  SETTLEMENT_CHANNELS,
  type SettlementBankMapping,
} from "@/features/accounting/mapping/aggregatorSettlement";

/**
 * Sesi AE-221 — REKENING TUJUAN SETTLEMENT, TERMASUK LEWAT SAPUAN.
 *
 * Kejadian nyata: QRIS Mahakan cair ke BNI, tapi 98 jurnal settlement
 * (Rp 60,5 juta) mendebit Bank BCA karena tujuannya ditebak dari nama
 * channel. Sesudah owner menyetel QRIS → BNI, jalur normal sudah benar,
 * TAPI sapuan otomatis per jam masih mengirim `bankAccountCode: null`
 * sehingga jatuh ke tebakan bawaan (BCA) — bug yang sama lewat pintu
 * belakang, dan tidak memunculkan error apa pun.
 *
 * Yang dikunci di sini: urutan penentuan rekening, dan bahwa pemetaan
 * owner mengalahkan tebakan bawaan untuk SEMUA channel.
 */

const MAP_MAHAKAN: SettlementBankMapping = { qris: "1113" };

describe("resolveSettlementBankCode — urutan penentuan (AE-221)", () => {
  it("pemetaan owner mengalahkan tebakan bawaan: QRIS → BNI, bukan BCA", () => {
    expect(resolveSettlementBankCode("qris", MAP_MAHAKAN)).toBe("1113");
    // Tebakan bawaan yang dulu dipakai — dikunci supaya bedanya kelihatan.
    expect(defaultBankCodeForChannel("qris")).toBe("1110");
  });

  it("rekening khusus di baris settlement mengalahkan pemetaan outlet", () => {
    expect(resolveSettlementBankCode("qris", MAP_MAHAKAN, "1111")).toBe("1111");
  });

  it("tanpa pemetaan sama sekali → perilaku LAMA (tebakan bawaan)", () => {
    expect(resolveSettlementBankCode("qris", null)).toBe("1110");
    expect(resolveSettlementBankCode("qris", undefined)).toBe("1110");
    expect(resolveSettlementBankCode("qris", {})).toBe("1110");
  });

  it("channel yang tidak dipetakan tetap memakai bawaannya sendiri", () => {
    // Owner cuma menyetel QRIS; EDC BNI jangan ikut tertarik ke 1113 QRIS.
    expect(resolveSettlementBankCode("edc_bni", MAP_MAHAKAN)).toBe("1113");
    expect(resolveSettlementBankCode("edc_bri", MAP_MAHAKAN)).toBe("1111");
    expect(resolveSettlementBankCode("edc_bca", MAP_MAHAKAN)).toBe("1110");
  });

  it("pemetaan kosong / spasi diperlakukan sebagai belum diatur", () => {
    expect(resolveSettlementBankCode("qris", { qris: "" })).toBe("1110");
    expect(resolveSettlementBankCode("qris", { qris: "   " })).toBe("1110");
  });

  /* Inti pelajaran AE-221: SEMUA jalur yang memposting jurnal settlement
   * wajib melewati fungsi ini. Sapuan otomatis dulu tidak, dan itulah
   * lubangnya. Tes ini menjaga fungsinya utuh untuk tiap channel. */
  it("setiap channel yang bisa diatur punya jawaban, tidak ada yang undefined", () => {
    for (const ch of SETTLEMENT_CHANNELS) {
      const code = resolveSettlementBankCode(ch, MAP_MAHAKAN);
      expect(code, ch).toMatch(/^\d{4}$/);
    }
  });

  it("owner memindah SEMUA channel ke satu rekening pun dihormati", () => {
    const semuaKeBni: SettlementBankMapping = Object.fromEntries(
      SETTLEMENT_CHANNELS.map((c) => [c, "1113"]),
    );
    for (const ch of SETTLEMENT_CHANNELS) {
      expect(resolveSettlementBankCode(ch, semuaKeBni), ch).toBe("1113");
    }
  });
});
