import type { InferSelectModel } from "drizzle-orm";
import type { shareTransactions } from "@/db/schema";

export type ShareTransaction = InferSelectModel<typeof shareTransactions>;
export type ShareTransactionKind =
  | "p2p_transfer"
  | "company_buyback"
  | "top_up"
  | "initial";

export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}
export function fail(
  code: string,
  message: string,
  field?: string,
): ApiResult<never> {
  return { success: false, error: { code, message, field } };
}
export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

export interface TransferShareP2PInput {
  fromInvestorId: string;
  toInvestorId: string;
  /** Share % yang dipindah (0..100, max = from.sharePct). */
  sharePctDelta: number;
  description?: string | null;
  occurredAt?: string | null;
}

export interface CompanyBuybackInput {
  fromInvestorId: string;
  sharePctDelta: number;
  amountIdr: number;
  bankAccountId: string;
  description?: string | null;
  occurredAt?: string | null;
}

export interface ReverseShareTransactionInput {
  id: string;
  reason: string;
}

export interface ShareTransactionListRow {
  id: string;
  kind: ShareTransactionKind;
  fromInvestorId: string | null;
  fromInvestorName: string | null;
  toInvestorId: string | null;
  toInvestorName: string | null;
  sharePctDelta: string;
  amountIdr: number;
  bankAccountId: string | null;
  bankLabel: string | null;
  occurredAt: Date;
  description: string | null;
  status: "posted" | "reversed";
  journalEntryId: string | null;
  reversedAt: Date | null;
  reversalReason: string | null;
  createdAt: Date;
  createdByName: string | null;
}
