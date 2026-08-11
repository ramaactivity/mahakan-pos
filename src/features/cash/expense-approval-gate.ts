import "server-only";
import bcrypt from "bcryptjs";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { approvalCodes, outlets } from "@/db/schema";
import { FAILED_ATTEMPTS_LOCKOUT_THRESHOLD } from "@/features/approval-codes/types";
import type { Role } from "@/lib/auth/rbac";

/**
 * Sesi AE-196 — gerbang "pengeluaran sebesar ini boleh dicatat?".
 *
 * Kodenya diverifikasi DAN dikonsumsi di sini, tepat sebelum pengeluarannya
 * ditulis. Sengaja tidak dipecah jadi dua langkah seperti compliment: di sini
 * pengeluarannya langsung tercatat setelah kode benar, jadi tidak ada jeda di
 * mana kode yang sudah dipakai masih menggantung tanpa tujuan.
 */
export interface ExpenseApprovalGateInput {
  outletId: string;
  userId: string;
  role: Role;
  amount: number;
  code: string | null;
}

export type ExpenseApprovalGateResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

/** Batas nominal yang wajib persetujuan Owner. 0 = fitur mati. */
export async function readExpenseApprovalThreshold(
  outletId: string,
): Promise<number> {
  const [row] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, outletId))
    .limit(1);
  const settings = row?.settings as
    | { approval?: { expenseApprovalThreshold?: number } }
    | null
    | undefined;
  const raw = settings?.approval?.expenseApprovalThreshold;
  return typeof raw === "number" && raw > 0 ? Math.round(raw) : 0;
}

export async function checkExpenseApprovalGate({
  outletId,
  userId,
  role,
  amount,
  code,
}: ExpenseApprovalGateInput): Promise<ExpenseApprovalGateResult> {
  if (role === "owner") return { ok: true };

  const threshold = await readExpenseApprovalThreshold(outletId);
  if (threshold <= 0 || amount < threshold) return { ok: true };

  if (!code) {
    return {
      ok: false,
      code: "EXPENSE_APPROVAL_REQUIRED",
      message: `Pengeluaran Rp ${amount.toLocaleString("id-ID")} butuh kode persetujuan Owner (batas Rp ${threshold.toLocaleString("id-ID")}).`,
    };
  }

  const [active] = await db
    .select()
    .from(approvalCodes)
    .where(
      and(
        eq(approvalCodes.outletId, outletId),
        eq(approvalCodes.actionType, "expense.create"),
        eq(approvalCodes.requestedByUserId, userId),
        isNull(approvalCodes.consumedAt),
        isNull(approvalCodes.revokedAt),
        gt(approvalCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(approvalCodes.createdAt))
    .limit(1);

  if (!active) {
    return {
      ok: false,
      code: "NO_ACTIVE_CODE",
      message: "Tidak ada kode aktif. Minta kode baru ke Owner.",
    };
  }

  if (active.failedAttempts >= FAILED_ATTEMPTS_LOCKOUT_THRESHOLD) {
    await db
      .update(approvalCodes)
      .set({ revokedAt: new Date(), revokedByUserId: userId })
      .where(eq(approvalCodes.id, active.id));
    return {
      ok: false,
      code: "LOCKED",
      message: "Kode dikunci karena terlalu banyak salah. Minta kode baru.",
    };
  }

  const match = await bcrypt.compare(code.trim(), active.codeHash);
  if (!match) {
    await db
      .update(approvalCodes)
      .set({ failedAttempts: active.failedAttempts + 1 })
      .where(eq(approvalCodes.id, active.id));
    return { ok: false, code: "CODE_INVALID", message: "Kode salah" };
  }

  /* Owner menyetujui SEBESAR itu. Nominal yang menyusut tetap boleh —
   * yang dilarang membengkak setelah kodenya keluar. */
  if (active.approvedAmount !== null && amount > active.approvedAmount) {
    return {
      ok: false,
      code: "EXPENSE_AMOUNT_EXCEEDED",
      message: `Kode ini disetujui untuk Rp ${active.approvedAmount.toLocaleString("id-ID")}, sedangkan yang dicatat Rp ${amount.toLocaleString("id-ID")}. Minta kode baru ke Owner.`,
    };
  }

  /* Konsumsi dengan CAS — dua permintaan bersamaan tidak bisa memakai kode
   * yang sama untuk dua pengeluaran. */
  const consumed = await db
    .update(approvalCodes)
    .set({ consumedAt: new Date(), consumedByUserId: userId })
    .where(
      and(eq(approvalCodes.id, active.id), isNull(approvalCodes.consumedAt)),
    )
    .returning({ id: approvalCodes.id });
  if (consumed.length === 0) {
    return {
      ok: false,
      code: "CODE_ALREADY_USED",
      message: "Kode sudah dipakai. Minta kode baru ke Owner.",
    };
  }

  return { ok: true };
}
