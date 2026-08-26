import { describe, expect, it } from "vitest";
import {
  defaultBankCodeForChannel,
  resolveSettlementBankCode,
  SETTLEMENT_CHANNEL_LABEL,
  SETTLEMENT_CHANNELS,
} from "@/features/accounting/mapping/aggregatorSettlement";

/**
 * Sesi AE-219 — aturan yang dijaga:
 *
 *   1. Rekening yang DIATUR OWNER menang atas tebakan bawaan. Ini inti
 *      masalahnya: QRIS Mahakan cair ke BNI, sementara tebakan bawaan
 *      mengarahkannya ke BCA dan tidak ada error apa pun yang muncul.
 *   2. Rekening yang menempel di satu baris settlement menang atas keduanya
 *      (kasus khusus: satu pencairan yang memang masuk ke rekening lain).
 *   3. Channel yang tidak diatur TIDAK berubah perilakunya.
 */

describe("resolveSettlementBankCode", () => {
  it("tanpa pengaturan apa pun = tebakan bawaan (perilaku lama)", () => {
    expect(resolveSettlementBankCode("qris")).toBe("1110");
    expect(resolveSettlementBankCode("edc_bca")).toBe("1110");
    expect(resolveSettlementBankCode("edc_bni")).toBe("1113");
    expect(resolveSettlementBankCode("edc_bri")).toBe("1111");
    expect(resolveSettlementBankCode("gofood")).toBe("1110");
  });

  it("pengaturan outlet mengalahkan tebakan bawaan", () => {
    const mapping = { qris: "1113" };
    expect(resolveSettlementBankCode("qris", mapping)).toBe("1113");
    /* Channel lain yang tidak diatur tidak boleh ikut bergeser. */
    expect(resolveSettlementBankCode("edc_bca", mapping)).toBe("1110");
    expect(resolveSettlementBankCode("edc_bri", mapping)).toBe("1111");
  });

  it("rekening di baris settlement mengalahkan semuanya", () => {
    expect(resolveSettlementBankCode("qris", { qris: "1113" }, "1112")).toBe(
      "1112",
    );
    expect(resolveSettlementBankCode("edc_bni", null, "1110")).toBe("1110");
  });

  it("nilai kosong / spasi dianggap tidak diatur", () => {
    expect(resolveSettlementBankCode("qris", { qris: "" })).toBe("1110");
    expect(resolveSettlementBankCode("qris", { qris: "   " })).toBe("1110");
    expect(resolveSettlementBankCode("qris", { qris: "1113" }, "")).toBe("1113");
    expect(resolveSettlementBankCode("qris", { qris: "1113" }, null)).toBe(
      "1113",
    );
  });

  it("merapikan spasi di sekitar kode akun", () => {
    expect(resolveSettlementBankCode("qris", { qris: " 1113 " })).toBe("1113");
  });

  it("pemetaan kosong tidak mengubah apa-apa", () => {
    for (const ch of SETTLEMENT_CHANNELS) {
      expect(resolveSettlementBankCode(ch, {})).toBe(
        defaultBankCodeForChannel(ch),
      );
    }
  });
});

describe("daftar channel", () => {
  it("semua channel punya label yang bisa dibaca owner", () => {
    for (const ch of SETTLEMENT_CHANNELS) {
      expect(SETTLEMENT_CHANNEL_LABEL[ch]).toBeTruthy();
      expect(SETTLEMENT_CHANNEL_LABEL[ch]).not.toBe(ch);
    }
  });

  it("tidak ada channel ganda", () => {
    expect(new Set(SETTLEMENT_CHANNELS).size).toBe(SETTLEMENT_CHANNELS.length);
  });
});
