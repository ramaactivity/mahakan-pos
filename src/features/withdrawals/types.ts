import type { InferSelectModel } from "drizzle-orm";
import type { withdrawalRequests } from "@/db/schema";

/**
 * Sesi AE-80 — Withdrawal request types.
 *
 * Pencairan saldo dividen investor (V2 flow). Direct (no pending state)
 * per user decision: owner-only, klik tarik → modal → confirm → post.
 */

export type WithdrawalRequest = InferSelectModel<typeof withdrawalRequests>;

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

export interface PostWithdrawalInput {
  investorId: string;
  amount: number;
  bankAccountId: string;
  /** Optional override tanggal (default = now). */
  occurredAt?: string | null;
  description?: string | null;
}

export interface ReverseWithdrawalInput {
  id: string;
  reason: string;
}

/** Joined view dengan investor name + bank label + status. */
export interface WithdrawalListRow {
  id: string;
  investorId: string;
  investorName: string;
  amount: number;
  bankAccountId: string;
  bankLabel: string;
  occurredAt: Date;
  status: "posted" | "reversed";
  reversedAt: Date | null;
  reversedBy: string | null;
  reversalReason: string | null;
  journalEntryId: string | null;
  createdAt: Date;
  createdByName: string | null;
}
