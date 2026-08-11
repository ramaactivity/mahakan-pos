"use server";

/**
 * Sesi AE-196 — approval kode Owner untuk PENGELUARAN KAS besar.
 *
 * Sebelum ini kasir bisa mencatat pengeluaran berapa pun tanpa persetujuan
 * siapa pun — hanya dibatasi hak akses. Sekarang Owner bisa menetapkan batas
 * (Pengaturan → Approval); pengeluaran sebesar batas itu atau lebih wajib
 * kode 6 digit dari Owner.
 *
 * MATI SECARA BAWAAN. Kalau batasnya tidak diisi (atau 0), tidak ada yang
 * berubah — belanja harian tidak boleh terhenti gara-gara fitur ini menyala
 * dengan angka yang bukan pilihan Owner.
 *
 * Bentuknya meniru compliment: tidak ada baris target, karena pengeluarannya
 * memang belum tercatat saat kode diminta. Pengamannya = scope outlet +
 * sekali pakai + TTL + terikat nominal yang disetujui.
 */

import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { approvalCodes, outlets } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { sendEmail } from "@/lib/email/send";
import { buildApprovalCodeEmail } from "@/lib/email/templates/approval-code";
import { sendPushToOutletVerifiers } from "@/features/push-notifications/server";
import { resolveOwnerEmailRecipients } from "./recipients";
import { approvalResendWaitSeconds } from "./resend-cooldown-db";
import { resendCooldownMessage } from "./resend-cooldown";
import {
  fail,
  ok,
  computeApprovalCodeExpiry,
  generateNumericCode6,
  maskEmail,
  type ApiResult,
  type RequestApprovalCodeResult,
} from "./types";

const BCRYPT_COST = 10;
const DESC_MIN = 3;
const DESC_MAX = 200;

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export interface RequestExpenseCodeInput {
  /** Nominal pengeluaran yang mau dicatat. */
  amount: number;
  /** Keterangan pengeluaran — ikut di email supaya Owner tahu untuk apa. */
  description: string;
}

export interface ExpenseCodeResult extends RequestApprovalCodeResult {
  pushSent: number;
}

/**
 * Batas nominal yang butuh persetujuan Owner. 0 = fitur mati.
 * Dipakai server (penegakan) DAN client (memutuskan perlu tampil kolom kode).
 */
export async function getExpenseApprovalThreshold(): Promise<
  ApiResult<{ threshold: number }>
> {
  const session = await requireSession();
  const [row] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  const settings = row?.settings as
    | { approval?: { expenseApprovalThreshold?: number } }
    | null
    | undefined;
  /* Owner dikecualikan — dialah yang menyetujui. Mengembalikan 0 untuknya
   * membuat layar POS tidak perlu tahu peran siapa pun: kalau 0, tidak ada
   * kolom kode yang muncul. */
  if (session.user.role === "owner") return ok({ threshold: 0 });
  const raw = settings?.approval?.expenseApprovalThreshold;
  const threshold = typeof raw === "number" && raw > 0 ? Math.round(raw) : 0;
  return ok({ threshold });
}

/**
 * Minta kode approval pengeluaran. Kode dikirim ke Owner (email + notifikasi
 * HP), TIDAK pernah dikembalikan ke pemanggil.
 */
export async function requestExpenseApprovalCode(
  input: RequestExpenseCodeInput,
): Promise<ApiResult<ExpenseCodeResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "expense.create")) {
    return fail("FORBIDDEN", "Tidak punya hak mencatat pengeluaran");
  }

  const description = input.description.trim();
  if (description.length < DESC_MIN || description.length > DESC_MAX) {
    return fail(
      "INVALID_DESCRIPTION",
      `Keterangan ${DESC_MIN}-${DESC_MAX} karakter`,
    );
  }
  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return fail("INVALID_AMOUNT", "Nominal pengeluaran belum diisi");
  }

  const waitSec = await approvalResendWaitSeconds(
    "expense.create",
    and(
      eq(approvalCodes.outletId, session.user.outletId),
      eq(approvalCodes.requestedByUserId, session.user.id),
    ),
  );
  if (waitSec > 0) return fail("TOO_SOON", resendCooldownMessage(waitSec));

  const recipients = await resolveOwnerEmailRecipients(session.user.outletId);
  if (!recipients || recipients.emails.length === 0) {
    return fail(
      "NO_OWNER_EMAIL",
      "Email Owner belum diset. Owner login → Pengaturan → tambah email approval dulu.",
    );
  }

  const code = generateNumericCode6();
  const codeHash = await bcrypt.hash(code, BCRYPT_COST);
  const now = new Date();
  const expiresAt = computeApprovalCodeExpiry(now);

  let inserted;
  try {
    inserted = await db.transaction(async (tx) => {
      /* Cabut kode lama + insert baru dalam SATU transaksi supaya tidak
       * pernah ada dua kode aktif bersamaan untuk kasir yang sama. */
      await tx
        .update(approvalCodes)
        .set({ revokedAt: now, revokedByUserId: session.user.id })
        .where(
          and(
            eq(approvalCodes.outletId, session.user.outletId),
            eq(approvalCodes.actionType, "expense.create"),
            eq(approvalCodes.requestedByUserId, session.user.id),
            isNull(approvalCodes.consumedAt),
            isNull(approvalCodes.revokedAt),
            gt(approvalCodes.expiresAt, now),
          ),
        );

      const [row] = await tx
        .insert(approvalCodes)
        .values({
          codeHash,
          codeFirstTwo: code.slice(0, 2),
          actionType: "expense.create",
          outletId: session.user.outletId,
          requestedByUserId: session.user.id,
          reason: description,
          expiresAt,
          /* Owner menyetujui SEBESAR ini — dicek ulang saat dicatat. */
          approvedAmount: amount,
        })
        .returning();
      return row;
    });
  } catch (e) {
    return fail(
      "DB_ERROR",
      e instanceof Error ? e.message : "Generate kode gagal",
    );
  }

  const [outletRow] = await db
    .select({ name: outlets.name })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  const outletName = outletRow?.name ?? "Mahakan Coffee & Space";

  const sendResults = await Promise.all(
    recipients.emails.map((toEmail) =>
      sendEmail(
        buildApprovalCodeEmail({
          toEmail,
          ownerName: recipients.primaryOwner?.name ?? "Owner",
          actionType: "expense.create",
          code,
          transactionNumber: null,
          transactionTotal: amount,
          reason: description,
          requestedByName: session.user.name,
          requestedByRole: session.user.role,
          expiresAt,
          outletName,
        }),
      ),
    ),
  );

  /* Notifikasi ke perangkat OWNER — bukan perangkat peminta. Kalau kodenya
   * mampir di layar kasir, persetujuannya jadi tidak berarti apa-apa. */
  const push = await sendPushToOutletVerifiers(
    session.user.outletId,
    {
      title: `Kode pengeluaran: ${code}`,
      body: `${session.user.name} minta persetujuan pengeluaran Rp ${new Intl.NumberFormat("id-ID").format(amount)} — ${description}`,
      tag: "expense-approval",
      url: "/dashboard",
    },
    { roles: ["owner"] },
  ).catch(() => ({ sent: 0, cleaned: 0, failed: 0 }));

  const anySent = sendResults.some((r) => r.mode === "sent");
  const anyLogged = sendResults.some((r) => r.mode === "logged");
  const emailMode: "sent" | "logged" | "failed" = anySent
    ? "sent"
    : anyLogged
      ? "logged"
      : "failed";

  await logAudit({
    eventType: "approval_code.generate",
    userId: session.user.id,
    entityType: "approval_code",
    entityId: inserted.id,
    payload: {
      summary: `Request pengeluaran Rp ${amount} — kode ke ${recipients.emails.map(maskEmail).join(", ")} (${emailMode}), notifikasi ${push.sent} perangkat`,
      context: {
        actionType: "expense.create",
        description,
        amount,
      },
    },
  });

  return ok({
    codeFirstTwo: inserted.codeFirstTwo,
    expiresAt: expiresAt.toISOString(),
    emailMode,
    ownerEmailMasked: maskEmail(recipients.emails[0] ?? ""),
    pushSent: push.sent,
  });
}
