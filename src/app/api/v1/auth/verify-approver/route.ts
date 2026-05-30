import { NextResponse } from "next/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { issueApproverToken } from "@/lib/auth/approver";
import { hasPermission, type Permission } from "@/lib/auth";
import {
  clearFailedAttempts,
  isLocked,
  recordFailedAttempt,
} from "@/lib/auth/lockout";
import { verifyPin, isValidPinFormat } from "@/lib/auth/pin";

const APPROVER_ACTIONS: ReadonlyArray<Permission> = [
  "pos.transaction.void",
  "pos.transaction.refund",
  "pos.discount.apply",
  "shift.opening_cash.correct",
];

const bodySchema = z.object({
  approverId: z.uuid(),
  pin: z.string().refine(isValidPinFormat, "PIN harus 4-6 digit"),
  actionType: z.enum(APPROVER_ACTIONS),
  targetEntityId: z.uuid().nullable().optional(),
});

function err(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status },
  );
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return err("UNAUTHORIZED", "Sesi tidak ditemukan", 401);

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return err("BAD_REQUEST", "Input tidak valid", 400);
  }

  const { approverId, pin, actionType, targetEntityId } = parsed.data;

  const [approver] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.id, approverId),
        eq(users.status, "active"),
        isNull(users.deletedAt),
        isNotNull(users.pinHash),
      ),
    )
    .limit(1);

  if (!approver) {
    return err("APPROVER_NOT_FOUND", "Approver tidak ditemukan", 404);
  }
  // Sesi AE-62i — separation of duties: requester tidak boleh approve diri
  // sendiri. Sebelumnya supervisor/manager bisa input PIN sendiri sebagai
  // approver → bypass independent oversight on void/refund/discount.
  if (approver.id === session.user.id) {
    return err(
      "SELF_APPROVE_DENIED",
      "Tidak boleh approve diri sendiri — minta approver lain",
      403,
    );
  }
  // Sesi AE-62i — outlet boundary. Approver dari outlet lain tidak boleh
  // approve transaksi outlet ini (audit trail jadi salah outlet attribution).
  if (approver.outletId !== session.user.outletId) {
    return err(
      "APPROVER_OUTLET_MISMATCH",
      "Approver dari outlet berbeda — tidak boleh approve cross-outlet",
      403,
    );
  }
  if (approver.role !== "owner" && approver.role !== "manager") {
    return err(
      "APPROVER_INELIGIBLE",
      "Hanya Owner/Manager yang bisa approve",
      403,
    );
  }
  if (!hasPermission(approver.role, actionType)) {
    return err(
      "APPROVER_PERMISSION_DENIED",
      `Approver tidak punya hak ${actionType}`,
      403,
    );
  }

  // Lockout gate (sesi AC-5b ramaactivity/code-review #2):
  // verify-approver dulu tidak track failed PIN attempts → approver PIN
  // bisa di-brute-force unlimited (bcrypt ~100ms × 1M kombinasi 6-digit
  // = 28 jam). Reuse same lockout (5 attempts → 15 menit lock) yang
  // dipakai login flow.
  if (isLocked(approver.lockedUntil)) {
    return err(
      "APPROVER_LOCKED",
      "Approver di-lock karena terlalu banyak PIN salah. Coba lagi setelah 15 menit.",
      429,
    );
  }

  const ok = await verifyPin(pin, approver.pinHash!);
  if (!ok) {
    const lockResult = await recordFailedAttempt(
      approver.id,
      approver.failedAttempts,
    );
    if (lockResult.locked) {
      return err(
        "APPROVER_LOCKED",
        "Approver di-lock 15 menit setelah terlalu banyak PIN salah.",
        429,
      );
    }
    return err("INVALID_PIN", "PIN salah", 401);
  }
  // PIN benar — clear failed attempts kalau ada residual.
  if (approver.failedAttempts > 0 || approver.lockedUntil) {
    await clearFailedAttempts(approver.id);
  }

  const token = await issueApproverToken({
    approverId: approver.id,
    approverRole: approver.role,
    actionType,
    targetEntityId: targetEntityId ?? null,
  });

  return NextResponse.json({
    success: true,
    data: {
      approverToken: token,
      approverId: approver.id,
      approverName: approver.name,
      approverRole: approver.role,
      expiresInSeconds: 5 * 60,
    },
  });
}
