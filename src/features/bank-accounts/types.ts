import type { InferSelectModel } from "drizzle-orm";
import type { bankAccounts } from "@/db/schema";

export type BankAccount = InferSelectModel<typeof bankAccounts>;

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): ApiResult<never> {
  return { ok: false, error: { code, message } };
}

export type CreateBankAccountInput = {
  bankName: string;
  accountName: string;
  accountNumber?: string;
  notes?: string | null;
  displayOrder?: number;
};

export type UpdateBankAccountInput = {
  id: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  notes?: string | null;
  displayOrder?: number;
  isActive?: boolean;
};

/** Format helper untuk display dropdown / detail. */
export function formatBankAccountDisplay(b: BankAccount): string {
  const num = b.accountNumber.trim();
  const tail = num.length > 4 ? `...${num.slice(-4)}` : num;
  const numPart = tail ? ` ${tail}` : "";
  return `${b.bankName} — ${b.accountName}${numPart}`;
}
