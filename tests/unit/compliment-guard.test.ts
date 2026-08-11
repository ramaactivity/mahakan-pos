import { describe, expect, it } from "vitest";
import {
  checkComplimentApproval,
  type ComplimentCodeRow,
} from "@/features/approval-codes/compliment-guard";

const OUTLET = "outlet-1";
const KASIR = "user-kasir";
const REASON = "Compliment: Tamu Owner";

function row(over: Partial<ComplimentCodeRow> = {}): ComplimentCodeRow {
  return {
    outletId: OUTLET,
    consumedByUserId: KASIR,
    usedForTransactionId: null,
    reason: REASON,
    approvedAmount: 45000,
    ...over,
  };
}

function check(over: Partial<Parameters<typeof checkComplimentApproval>[0]> = {}) {
  return checkComplimentApproval({
    row: row(),
    outletId: OUTLET,
    userId: KASIR,
    discountReason: REASON,
    subtotal: 45000,
    ...over,
  });
}

describe("checkComplimentApproval", () => {
  it("meloloskan kode yang sah", () => {
    expect(check()).toEqual({ ok: true });
  });

  it("menolak kode yang tidak ditemukan", () => {
    const r = check({ row: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("COMPLIMENT_APPROVAL_INVALID");
  });

  it("menolak kode milik outlet lain", () => {
    const r = check({ row: row({ outletId: "outlet-2" }) });
    if (!r.ok) expect(r.code).toBe("COMPLIMENT_APPROVAL_INVALID");
    else throw new Error("harus ditolak");
  });

  it("menolak kode yang dimasukkan kasir lain", () => {
    const r = check({ row: row({ consumedByUserId: "user-lain" }) });
    if (!r.ok) expect(r.code).toBe("COMPLIMENT_APPROVAL_INVALID");
    else throw new Error("harus ditolak");
  });

  it("menolak kode yang sudah dipakai transaksi lain", () => {
    const r = check({ row: row({ usedForTransactionId: "trx-lain" }) });
    if (!r.ok) expect(r.code).toBe("COMPLIMENT_APPROVAL_ALREADY_USED");
    else throw new Error("harus ditolak");
  });

  it("mengizinkan edit ulang bill yang sama", () => {
    expect(
      check({
        row: row({ usedForTransactionId: "trx-ini" }),
        allowLinkedTransactionId: "trx-ini",
      }),
    ).toEqual({ ok: true });
  });

  it("menolak alasan yang berbeda dari yang disetujui", () => {
    const r = check({ discountReason: "Compliment: Teman kasir" });
    if (!r.ok) expect(r.code).toBe("COMPLIMENT_REASON_MISMATCH");
    else throw new Error("harus ditolak");
  });

  it("menolak keranjang yang lebih besar dari yang disetujui", () => {
    const r = check({ subtotal: 2_000_000 });
    if (!r.ok) {
      expect(r.code).toBe("COMPLIMENT_AMOUNT_EXCEEDED");
      expect(r.message).toContain("45.000");
    } else throw new Error("harus ditolak");
  });

  it("mengizinkan keranjang yang menyusut", () => {
    expect(check({ subtotal: 20000 })).toEqual({ ok: true });
  });

  it("melewati cek nominal untuk kode lama tanpa approvedAmount", () => {
    expect(
      check({ row: row({ approvedAmount: null }), subtotal: 2_000_000 }),
    ).toEqual({ ok: true });
  });
});
