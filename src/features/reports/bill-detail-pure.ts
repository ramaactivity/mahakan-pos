/**
 * Sesi AE-237 — Detail Bill: "turunnya bill ini pindah ke bill mana?"
 *
 * Kasir yang menurunkan open bill biasanya beralasan item dipindah ke bill
 * lain / dibayar terpisah (split). Kalau itu benar, di SHIFT YANG SAMA harus
 * ada jejaknya: bill lain yang naik tepat sebesar itu, bill baru senilai itu,
 * transaksi langsung senilai itu, atau item yang dihapus muncul di bill lain.
 * Fungsi ini mencari jejak itu dari audit log — murni, tanpa DB.
 *
 * Batas data: nama item per edit baru dicatat sejak AE-234 (25 Sep 2026).
 * Sebelum itu hanya total yang bisa dicocokkan.
 */

export interface DetailItemLine {
  name: string;
  qty: number;
  subtotal: number;
}

export interface DetailItemChange {
  name: string;
  qty: number;
}

/** Satu kejadian "uang/item masuk" ke bill LAIN di shift yang sama. */
export interface InflowEvent {
  transactionId: string;
  transactionNumber: string;
  customerName: string | null;
  status: string;
  at: string; // ISO
  kind: "edit_up" | "new_bill" | "direct_sale";
  amount: number;
  /** null = nama item tidak tercatat (sebelum AE-234). */
  items: DetailItemChange[] | null;
}

export interface MoveCandidate extends InflowEvent {
  /** Nominalnya sama dengan selisih turun (item dipindah ke bill ini). */
  amountMatch: boolean;
  /** Nominalnya sama dengan total SEBELUM edit — pesanan asli dibayar
   * sebagai transaksi terpisah, bill lama dipakai ulang (kasus Kapras
   * TRX-20260924-0003 → 0013, AE-234). */
  fullBeforeMatch: boolean;
  /** Nama item yang dihapus dari bill ini dan muncul di bill kandidat. */
  itemMatches: string[];
  minutesFromEdit: number;
}

export type ReductionVerdict =
  | "moved" // nominal sama + item cocok
  | "likely_moved" // nominal sama, item tidak bisa dicek
  | "paid_separately" // ada transaksi lain senilai total sebelum edit
  | "partial" // sebagian item muncul di bill lain, nominal beda
  | "item_mismatch" // nominal sama tapi itemnya beda
  | "no_trace"; // tidak ada jejak sama sekali

export interface BillReduction {
  at: string;
  totalBefore: number;
  totalAfter: number;
  amount: number;
  removed: DetailItemChange[] | null;
  added: DetailItemChange[] | null;
  candidates: MoveCandidate[];
  verdict: ReductionVerdict;
}

/** Window pencarian: kejadian di bill lain sejauh ini dari edit turun. */
const MAX_MINUTES = 180;

export function findMoveCandidates(
  reduction: {
    at: string;
    amount: number;
    totalBefore: number;
    removed: DetailItemChange[] | null;
  },
  inflows: InflowEvent[],
): { candidates: MoveCandidate[]; verdict: ReductionVerdict } {
  const editMs = Date.parse(reduction.at);
  const removedNames = new Set((reduction.removed ?? []).map((r) => r.name));
  const candidates: MoveCandidate[] = [];

  for (const ev of inflows) {
    const minutesFromEdit = Math.round((Date.parse(ev.at) - editMs) / 60000);
    if (Math.abs(minutesFromEdit) > MAX_MINUTES) continue;
    const amountMatch = ev.amount === reduction.amount;
    const fullBeforeMatch = !amountMatch && ev.amount === reduction.totalBefore;
    const itemMatches =
      ev.items && removedNames.size > 0
        ? [...new Set(ev.items.map((i) => i.name).filter((n) => removedNames.has(n)))]
        : [];
    if (!amountMatch && !fullBeforeMatch && itemMatches.length === 0) continue;
    candidates.push({ ...ev, amountMatch, fullBeforeMatch, itemMatches, minutesFromEdit });
  }

  candidates.sort(
    (a, b) =>
      Number(b.amountMatch || b.fullBeforeMatch) + b.itemMatches.length -
        (Number(a.amountMatch || a.fullBeforeMatch) + a.itemMatches.length) ||
      Math.abs(a.minutesFromEdit) - Math.abs(b.minutesFromEdit),
  );

  const itemsKnown = reduction.removed !== null;
  let verdict: ReductionVerdict = "no_trace";
  if (candidates.some((c) => c.amountMatch && c.itemMatches.length > 0)) verdict = "moved";
  else if (candidates.some((c) => c.amountMatch && (!itemsKnown || c.items === null)))
    verdict = "likely_moved";
  else if (candidates.some((c) => c.fullBeforeMatch)) verdict = "paid_separately";
  else if (candidates.some((c) => c.itemMatches.length > 0)) verdict = "partial";
  else if (candidates.some((c) => c.amountMatch)) verdict = "item_mismatch";

  return { candidates, verdict };
}

// ---------- Detail payload (shared server ↔ client) ----------

export interface BillTrailStep {
  at: string;
  eventType: string;
  /** create | edit | close | cancel | split | reprint | other */
  kind: string;
  actorName: string | null;
  crewName: string | null;
  totalBefore: number | null;
  totalAfter: number | null;
  /** Isi bill SETELAH langkah ini. null = tidak tercatat (sebelum AE-234). */
  items: DetailItemLine[] | null;
  removed: DetailItemChange[] | null;
  added: DetailItemChange[] | null;
  /** Alasan yang diketik kasir (cancel / edit sejak AE-237). */
  reason: string | null;
  summary: string;
}

export interface BillDetail {
  transactionId: string;
  transactionNumber: string;
  status: string;
  customerName: string | null;
  openedAt: string;
  paidAt: string | null;
  paymentMethod: string;
  total: number;
  discountAmount: number;
  discountReason: string | null;
  cashReceived: number | null;
  cashChange: number | null;
  cashierName: string | null;
  openedCrew: string | null;
  paidCrew: string | null;
  items: DetailItemLine[];
  /** Bill saat pertama disimpan (open bill). null = transaksi langsung. */
  initial: { at: string; total: number; itemCount: number | null; items: DetailItemLine[] | null } | null;
  trail: BillTrailStep[];
  reductions: BillReduction[];
  splitPayments: Array<{ paymentMethod: string; amount: number; at: string }>;
  shift: { openedAt: string; closedAt: string | null; variance: number | null } | null;
}
