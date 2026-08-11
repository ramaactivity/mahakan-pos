import { describe, expect, it } from "vitest";
import {
  APPROVAL_RESEND_COOLDOWN_MS,
  resendCooldownMessage,
  resendCooldownWaitSeconds,
} from "@/features/approval-codes/resend-cooldown";

const NOW = new Date("2026-08-11T10:00:00.000Z");

function agoMs(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe("resendCooldownWaitSeconds", () => {
  it("mengizinkan permintaan pertama (belum pernah ada kode)", () => {
    expect(resendCooldownWaitSeconds(null, NOW)).toBe(0);
    expect(resendCooldownWaitSeconds(undefined, NOW)).toBe(0);
  });

  it("menahan permintaan yang baru saja dikirim", () => {
    expect(resendCooldownWaitSeconds(agoMs(0), NOW)).toBe(45);
  });

  it("menghitung sisa detik yang benar di tengah jeda", () => {
    expect(resendCooldownWaitSeconds(agoMs(30_000), NOW)).toBe(15);
    expect(resendCooldownWaitSeconds(agoMs(44_500), NOW)).toBe(1);
  });

  it("melepas tepat setelah jeda habis", () => {
    expect(
      resendCooldownWaitSeconds(agoMs(APPROVAL_RESEND_COOLDOWN_MS), NOW),
    ).toBe(0);
    expect(resendCooldownWaitSeconds(agoMs(120_000), NOW)).toBe(0);
  });

  it("tidak mengunci kasir kalau jam server bergeser mundur", () => {
    const masaDepan = new Date(NOW.getTime() + 60 * 60 * 1000);
    expect(resendCooldownWaitSeconds(masaDepan, NOW)).toBe(0);
  });

  it("pesannya menyebut sisa detik dan menenangkan soal kode lama", () => {
    const msg = resendCooldownMessage(15);
    expect(msg).toContain("15 detik");
    expect(msg).toContain("masih berlaku");
  });
});
