/**
 * Sesi AE-240 — structured reasons for cancelling an open bill.
 *
 * Free-text reasons let a paid bill disappear as "Pindah bill" with no bill it
 * moved to (TRX-20260826-0008 "Sekal", Rp 48.000, cancelled one minute after
 * another bill was edited down). Every reason now carries something the
 * server can check: the out-of-stock items, or the bill the order went to.
 * "Already paid" is deliberately not a reason — a paid bill is CLOSED.
 *
 * Shared by the POS form and cancelOpenBill so both apply the same rules.
 */

export const CANCEL_REASON_CODES = [
  "out_of_stock",
  "moved_to_bill",
  "duplicate_input",
  "customer_left",
  "other",
] as const;
export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];

export interface CancelReasonSpec {
  code: CancelReasonCode;
  label: string;
  hint: string;
  /** Must pick the bill the order went to / the correct duplicate. */
  needsTargetBill: boolean;
  /** Must tick the bill items that ran out. */
  needsItems: boolean;
  /** Minimum length of the free-text detail (0 = optional). */
  minDetail: number;
}

export const CANCEL_REASONS: CancelReasonSpec[] = [
  {
    code: "out_of_stock",
    label: "Stok habis",
    hint: "Centang item yang habis. Menu itu otomatis ditandai Habis di POS.",
    needsTargetBill: false,
    needsItems: true,
    minDetail: 0,
  },
  {
    code: "moved_to_bill",
    label: "Pindah ke bill lain",
    hint: "Pilih bill tujuan. Bill tujuan harus ada di shift ini.",
    needsTargetBill: true,
    needsItems: false,
    minDetail: 0,
  },
  {
    code: "duplicate_input",
    label: "Dobel input",
    hint: "Pilih bill yang benar (kembarannya).",
    needsTargetBill: true,
    needsItems: false,
    minDetail: 0,
  },
  {
    code: "customer_left",
    label: "Tamu batal / pergi",
    hint: "Tulis singkat: pesanan sudah dibuat atau belum?",
    needsTargetBill: false,
    needsItems: false,
    minDetail: 3,
  },
  {
    code: "other",
    label: "Lainnya",
    hint: "Jelaskan dengan lengkap (minimal 10 huruf).",
    needsTargetBill: false,
    needsItems: false,
    minDetail: 10,
  },
];

export function cancelReasonSpec(code: CancelReasonCode): CancelReasonSpec {
  return CANCEL_REASONS.find((r) => r.code === code)!;
}

export interface CancelReasonInput {
  reasonCode: CancelReasonCode;
  detail?: string | null;
  itemIds?: string[];
  targetBill?: string | null;
}

/** Null when complete, otherwise the message to show (same text on POS and server). */
export function cancelReasonProblem(v: CancelReasonInput): string | null {
  const spec = cancelReasonSpec(v.reasonCode);
  const detail = (v.detail ?? "").trim();
  if (spec.needsItems && (v.itemIds ?? []).length === 0) {
    return "Centang item yang stoknya habis.";
  }
  if (spec.needsTargetBill && !(v.targetBill ?? "").trim()) {
    return `Pilih atau ketik nomor bill ${spec.code === "duplicate_input" ? "yang benar" : "tujuan"}.`;
  }
  if (detail.length < spec.minDetail) {
    return spec.minDetail >= 10
      ? "Keterangan minimal 10 huruf supaya jelas."
      : "Keterangan wajib diisi.";
  }
  return null;
}

/** Human sentence stored as transactions.void_reason / audit summary. */
export function formatCancelReason(
  code: CancelReasonCode,
  parts: { detail?: string | null; itemNames?: string[]; targetNumber?: string | null },
): string {
  const spec = cancelReasonSpec(code);
  const bits: string[] = [spec.label];
  if (parts.itemNames?.length) bits.push(parts.itemNames.join(", "));
  if (parts.targetNumber) bits.push(`ke ${parts.targetNumber}`);
  const detail = (parts.detail ?? "").trim();
  if (detail) bits.push(detail);
  return bits.join(" — ").slice(0, 200);
}

/**
 * Typed bill reference → transaction-number suffix to look up within the
 * shift. Accepts the full number or just its trailing digits ("15", "0015").
 */
export function normalizeBillRef(ref: string): { full: string | null; suffix: string | null } {
  const s = ref.trim().toUpperCase();
  if (/^TRX-\d{8}-\d{4}$/.test(s)) return { full: s, suffix: null };
  if (/^\d{1,4}$/.test(s)) return { full: null, suffix: s.padStart(4, "0") };
  return { full: null, suffix: null };
}
