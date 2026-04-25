import { NextResponse } from "next/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { issueApproverToken } from "@/lib/auth/approver";
import { hasPermission, type Permission } from "@/lib/auth";
import { verifyPin, isValidPinFormat } from "@/lib/auth/pin";

const APPROVER_ACTIONS: ReadonlyArray<Permission> = [
  "pos.transaction.void",
  "pos.transaction.refund",
  "pos.discount.apply",
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

  const ok = await verifyPin(pin, approver.pinHash!);
  if (!ok) {
    return err("INVALID_PIN", "PIN salah", 401);
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
