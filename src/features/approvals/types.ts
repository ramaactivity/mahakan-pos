/**
 * Unified types untuk Pusat Persetujuan (Approval Queue).
 *
 * Menggabungkan 5 sumber pending approval ke shape yang sama supaya UI
 * bisa render satu list konsisten:
 *   - shift.rebalance      → shift_rebalances
 *   - pos.transaction.correction → transaction_corrections
 *   - entry_change         → pending_entry_changes
 *   - pos.transaction.void   → approval_codes (no separate table)
 *   - pos.transaction.refund → approval_codes (no separate table)
 */

export type ApprovalKind =
  | "rebalance"
  | "correction"
  | "entry_change"
  | "void"
  | "refund";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

export interface UnifiedApprovalItem {
  /** Unique key: `<kind>:<row_id>`. UI uses this for React keys + actions. */
  key: string;
  kind: ApprovalKind;
  /** Source row id (rebalance.id, correction.id, change.id, approvalCode.id). */
  sourceId: string;
  status: ApprovalStatus;
  /** Indonesian label untuk display: "Void Transaksi", "Edit Pengeluaran", dst. */
  title: string;
  /** Short one-line summary untuk display di list: "TRX-20260528-0042 Rp 62.000". */
  subtitle: string;
  /** Optional rich fields dipakai detail card. */
  amount: number | null;
  reason: string;
  requesterName: string | null;
  requesterId: string;
  requestedAt: Date;
  outletId: string;
  /** Last-2-digit kode hint untuk pending; null kalau direct-approved. */
  codeFirstTwo: string | null;
  /** Approved/rejected metadata. */
  resolvedAt: Date | null;
  resolverName: string | null;
  rejectedReason: string | null;
  /** Whether journal entry sudah posted (cek field XJournalEntryId). */
  journalStatus: "n/a" | "pending" | "posted";
  /** Whether shift sudah ter-koreksi (untuk rebalance/correction). */
  shiftCorrectionStatus: "n/a" | "pending" | "applied";
  /** Direct-approve allowed? Owner-only. */
  canDirectApprove: boolean;
}

/** Compliment audit row — info-only, tidak butuh approval. */
export interface ComplimentAuditItem {
  transactionId: string;
  transactionNumber: string;
  total: number;
  cashierName: string | null;
  customerName: string | null;
  reason: string;
  createdAt: Date;
}
