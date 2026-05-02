/**
 * Purchase mappers per design doc §4.7-4.8.
 *
 * Three lifecycle events generate journal:
 *   1. purchase.create (cash/transfer): Dr Persediaan, Cr Kas/Bank
 *   2. purchase.create (TOP):           Dr Persediaan, Cr 2101 Hutang Dagang
 *   3. purchase.markPaid (TOP→paid):    Dr 2101 Hutang Dagang, Cr Kas/Bank
 *   4. purchase.cancel:                 Counter-entry (reverse all)
 *
 * Persediaan account selection per ingredient.section:
 *   kitchen → 1140
 *   bar → 1141
 *   supporting / cleaning / null → 1142
 *
 * Cash/Bank account selection per paymentMethod:
 *   cash             → 1101 Kas Tunai (Drawer POS)
 *   transfer_bca     → 1110 Bank BCA
 *   transfer_bri     → 1111 Bank BRI
 *   transfer_other   → 1112 Bank Lain-lain
 *   top              → 2101 Hutang Dagang (until mark paid)
 */

import type { JournalLineInput } from "../posting";

export type PurchasePaymentMethod =
  | "cash"
  | "transfer_bca"
  | "transfer_bri"
  | "transfer_other"
  | "top";

export type IngredientSection =
  | "kitchen"
  | "bar"
  | "supporting"
  | "cleaning"
  | null;

export type PurchaseLineAggregate = {
  /** Snapshot section dari purchase_items.section_at_purchase. */
  section: IngredientSection;
  /** subtotal per line aggregated. */
  amount: number;
};

export type PurchaseCreateInput = {
  purchaseId: string;
  /** "PO-202606-0001" or supplier label — for description. */
  purchaseLabel: string;
  outletId: string;
  /** Date of economic event (YYYY-MM-DD WIB). */
  entryDate: string;
  paymentMethod: PurchasePaymentMethod;
  /** Per-section breakdown. Sum across all = total purchase amount. */
  lines: PurchaseLineAggregate[];
  /** Total = sum lines (validated). */
  total: number;
};

export type PurchasePayInput = {
  purchaseId: string;
  purchaseLabel: string;
  outletId: string;
  entryDate: string;
  /** Method dipakai saat mark-paid (NOT necessarily original purchase payment). */
  paymentMethod: "cash" | "transfer_bca" | "transfer_bri" | "transfer_other";
  total: number;
};

export type PurchaseCancelInput = {
  purchaseId: string;
  purchaseLabel: string;
  outletId: string;
  entryDate: string;
  /** Original payment method (so we know what to reverse). */
  paymentMethod: PurchasePaymentMethod;
  /** Same lines structure as create. */
  lines: PurchaseLineAggregate[];
  total: number;
};

const PERSEDIAAN_BY_SECTION: Record<NonNullable<IngredientSection> | "null", string> = {
  kitchen: "1140",
  bar: "1141",
  supporting: "1142",
  cleaning: "1142",
  null: "1142",
};

function persediaanCode(section: IngredientSection): string {
  return PERSEDIAAN_BY_SECTION[(section ?? "null") as keyof typeof PERSEDIAAN_BY_SECTION];
}

const CASH_BANK_BY_METHOD: Record<
  Exclude<PurchasePaymentMethod, "top">,
  string
> = {
  cash: "1101",
  transfer_bca: "1110",
  transfer_bri: "1111",
  transfer_other: "1112",
};

function cashBankCode(
  method: Exclude<PurchasePaymentMethod, "top">,
): string {
  return CASH_BANK_BY_METHOD[method];
}

/**
 * Aggregate per-section amounts → 1 line per persediaan account
 * (multiple sections → multiple Dr lines, but kitchen+bar+other separate).
 */
function aggregatePersediaanLines(
  lines: PurchaseLineAggregate[],
  descriptionPrefix: string,
): JournalLineInput[] {
  const bySection: Record<string, number> = {};
  for (const l of lines) {
    if (l.amount <= 0) continue;
    const code = persediaanCode(l.section);
    bySection[code] = (bySection[code] ?? 0) + l.amount;
  }

  const labels: Record<string, string> = {
    "1140": "kitchen",
    "1141": "bar",
    "1142": "pendukung",
  };

  return Object.entries(bySection).map(([code, amount]) => ({
    accountCode: code,
    debit: amount,
    description: `${descriptionPrefix} ${labels[code] ?? "persediaan"}`,
  }));
}

export function mapPurchaseCreate(
  input: PurchaseCreateInput,
): JournalLineInput[] {
  if (input.total <= 0) {
    throw new Error("MAP_PURCHASE_CREATE_NONPOSITIVE");
  }
  const linesSum = input.lines.reduce((s, l) => s + l.amount, 0);
  if (linesSum !== input.total) {
    throw new Error(
      `MAP_PURCHASE_CREATE_LINES_MISMATCH:lines=${linesSum},total=${input.total}`,
    );
  }

  const result: JournalLineInput[] = [
    ...aggregatePersediaanLines(input.lines, "Persediaan"),
  ];

  // Cr side: cash/bank atau Hutang Dagang
  if (input.paymentMethod === "top") {
    result.push({
      accountCode: "2101",
      credit: input.total,
      description: `Hutang dagang ${input.purchaseLabel}`,
    });
  } else {
    result.push({
      accountCode: cashBankCode(input.paymentMethod),
      credit: input.total,
      description: `Pembayaran ${input.paymentMethod} ${input.purchaseLabel}`,
    });
  }

  return result;
}

export function mapPurchasePay(input: PurchasePayInput): JournalLineInput[] {
  if (input.total <= 0) {
    throw new Error("MAP_PURCHASE_PAY_NONPOSITIVE");
  }

  return [
    {
      accountCode: "2101",
      debit: input.total,
      description: `Bayar hutang ${input.purchaseLabel}`,
    },
    {
      accountCode: cashBankCode(input.paymentMethod),
      credit: input.total,
      description: `${input.paymentMethod} ${input.purchaseLabel}`,
    },
  ];
}

export function mapPurchaseCancel(
  input: PurchaseCancelInput,
): JournalLineInput[] {
  if (input.total <= 0) {
    throw new Error("MAP_PURCHASE_CANCEL_NONPOSITIVE");
  }
  const linesSum = input.lines.reduce((s, l) => s + l.amount, 0);
  if (linesSum !== input.total) {
    throw new Error("MAP_PURCHASE_CANCEL_LINES_MISMATCH");
  }

  // Counter-entry: flip Dr ↔ Cr from create.
  const result: JournalLineInput[] = [];

  // Cr Persediaan per section (reverse the inventory increase)
  const bySection: Record<string, number> = {};
  for (const l of input.lines) {
    if (l.amount <= 0) continue;
    const code = persediaanCode(l.section);
    bySection[code] = (bySection[code] ?? 0) + l.amount;
  }
  for (const [code, amount] of Object.entries(bySection)) {
    result.push({
      accountCode: code,
      credit: amount,
      description: `Reverse persediaan (cancel) ${input.purchaseLabel}`,
    });
  }

  // Dr cash/bank/hutang (reverse)
  if (input.paymentMethod === "top") {
    result.push({
      accountCode: "2101",
      debit: input.total,
      description: `Reverse hutang dagang (cancel) ${input.purchaseLabel}`,
    });
  } else {
    result.push({
      accountCode: cashBankCode(input.paymentMethod),
      debit: input.total,
      description: `Reverse pembayaran (cancel) ${input.purchaseLabel}`,
    });
  }

  return result;
}
