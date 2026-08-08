"use server";

/**
 * Sesi AE-195 — approval kode owner untuk COMPLIMENT (transaksi 100% gratis).
 *
 * Beda mendasar dari void/refund: compliment diminta saat keranjang MASIH DI
 * LAYAR — transaksinya belum ada, jadi kodenya tidak bisa ditambatkan ke satu
 * baris transaksi. Penggantinya, kode dikunci ke:
 *   - outlet + actionType 'pos.compliment'
 *   - satu kali pakai (`consumed_at`) + TTL
 *   - hanya satu kode aktif per outlet (request baru mencabut yang lama)
 *
 * Pengiriman kode ke owner: EMAIL + PUSH ke perangkat owner. Push penting
 * karena WhatsApp otomatis belum tersedia, dan kode TIDAK BOLEH lewat
 * perangkat kasir (kalau kasir bisa membacanya, approval-nya jadi percuma).
 */

import bcrypt from "bcryptjs";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvalCodes, outlets } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { sendEmail } from "@/lib/email/send";
import { buildApprovalCodeEmail } from "@/lib/email/templates/approval-code";
import { sendPushToOutletVerifiers } from "@/features/push-notifications/server";
import { resolveOwnerEmailRecipients } from "./recipients";
import {
  fail,
  ok,
  computeApprovalCodeExpiry,
  generateNumericCode6,
  maskEmail,
  FAILED_ATTEMPTS_LOCKOUT_THRESHOLD,
  type ApiResult,
  type RequestApprovalCodeResult,
} from "./types";

const BCRYPT_COST = 10;
const REASON_MIN = 3;
const REASON_MAX = 200;

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export interface RequestComplimentCodeInput {
  /** Alasan compliment, sudah termasuk prefiks "Compliment: ". */
  reason: string;
  /** Nilai keranjang yang akan digratiskan — ikut di email supaya owner
   * tahu besarnya sebelum menyetujui. */
  subtotal: number;
}

export interface ComplimentCodeResult extends RequestApprovalCodeResult {
  /** Kode juga dikirim sebagai push ke perangkat owner. */
  pushSent: number;
}

/**
 * Minta kode approval compliment. Kode dikirim ke owner (email + push),
 * TIDAK pernah dikembalikan ke pemanggil.
 */
export async function requestComplimentApprovalCode(
  input: RequestComplimentCodeInput,
): Promise<ApiResult<ComplimentCodeResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pos.compliment.request")) {
    return fail("FORBIDDEN", "Tidak punya hak minta approval compliment");
  }

  const reason = input.reason.trim();
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return fail("INVALID_REASON", `Alasan ${REASON_MIN}-${REASON_MAX} karakter`);
  }
  const subtotal = Number(input.subtotal);
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return fail("INVALID_SUBTOTAL", "Keranjang masih kosong");
  }

  const recipients = await resolveOwnerEmailRecipients(session.user.outletId);
  if (!recipients || recipients.emails.length === 0) {
    return fail(
      "NO_OWNER_EMAIL",
      "Email Owner belum diset. Owner login → Pengaturan → tambah email approval dulu.",
    );
  }

  const code = generateNumericCode6();
  const codeHash = await bcrypt.hash(code, BCRYPT_COST);
  const codeFirstTwo = code.slice(0, 2);
  const now = new Date();
  const expiresAt = computeApprovalCodeExpiry(now);

  let inserted;
  try {
    /* Cabut kode compliment lama + insert baru dalam SATU transaksi supaya
     * tidak pernah ada dua kode aktif bersamaan (pola yang sama dengan
     * AE-160c untuk void/refund). */
    inserted = await db.transaction(async (tx) => {
      await tx
        .update(approvalCodes)
        .set({ revokedAt: now, revokedByUserId: session.user.id })
        .where(
          and(
            eq(approvalCodes.outletId, session.user.outletId),
            eq(approvalCodes.actionType, "pos.compliment"),
            isNull(approvalCodes.consumedAt),
            isNull(approvalCodes.revokedAt),
            gt(approvalCodes.expiresAt, now),
          ),
        );

      const [row] = await tx
        .insert(approvalCodes)
        .values({
          codeHash,
          codeFirstTwo,
          actionType: "pos.compliment",
          outletId: session.user.outletId,
          requestedByUserId: session.user.id,
          reason,
          expiresAt,
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
          actionType: "pos.compliment",
          code,
          transactionNumber: null,
          transactionTotal: subtotal,
          reason,
          requestedByName: session.user.name,
          requestedByRole: session.user.role,
          expiresAt,
          outletName,
        }),
      ),
    ),
  );

  /* Push ke perangkat OWNER — bukan ke perangkat peminta. Ini pengganti
   * WhatsApp otomatis yang belum tersedia, dan lebih aman karena kodenya
   * tidak pernah singgah di layar kasir. */
  const push = await sendPushToOutletVerifiers(
    session.user.outletId,
    {
      title: `Kode compliment: ${code}`,
      body: `${session.user.name} minta compliment Rp ${new Intl.NumberFormat("id-ID").format(subtotal)} — ${reason}`,
      tag: "compliment-approval",
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
  const firstFailure = sendResults.find((r) => r.mode === "failed");

  await logAudit({
    eventType: "approval_code.generate",
    userId: session.user.id,
    entityType: "approval_code",
    entityId: inserted.id,
    payload: {
      summary: `Request compliment Rp ${subtotal} — kode ke ${recipients.emails.map(maskEmail).join(", ")} (${emailMode}), push ${push.sent} perangkat`,
      context: {
        actionType: "pos.compliment",
        reason,
        subtotal,
        codeFirstTwo,
        expiresAt: expiresAt.toISOString(),
        emailMode,
        pushSent: push.sent,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  }).catch((e) => console.error("[audit compliment.request]", e));

  return ok({
    codeFirstTwo,
    expiresAt: expiresAt.toISOString(),
    emailMode,
    ownerEmailMasked: recipients.emails.map(maskEmail).join(", "),
    emailError: firstFailure?.error,
    pushSent: push.sent,
  });
}

export interface ConsumeComplimentCodeResult {
  /** Alasan yang tercatat di kode — dipakai sebagai reason transaksi supaya
   * yang disetujui owner PERSIS yang diterapkan kasir. */
  approvedReason: string;
  approvalCodeId: string;
}

/**
 * Verifikasi kode compliment. Sekali sukses, kode langsung dikonsumsi.
 *
 * Mengembalikan `approvedReason` dari baris kode — BUKAN dari input kasir —
 * supaya kasir tidak bisa meminta approval untuk satu alasan lalu memakai
 * kodenya untuk alasan lain.
 */
export async function consumeComplimentApprovalCode(
  inputCode: string,
): Promise<ApiResult<ConsumeComplimentCodeResult>> {
  const session = await requireSession();
  const trimmed = inputCode.trim();
  if (!/^\d{6}$/.test(trimmed)) {
    return fail("INVALID_FORMAT", "Kode harus 6 digit angka");
  }

  const [active] = await db
    .select()
    .from(approvalCodes)
    .where(
      and(
        eq(approvalCodes.outletId, session.user.outletId),
        eq(approvalCodes.actionType, "pos.compliment"),
        isNull(approvalCodes.consumedAt),
        isNull(approvalCodes.revokedAt),
        gt(approvalCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(approvalCodes.createdAt))
    .limit(1);

  if (!active) {
    return fail(
      "NO_ACTIVE_CODE",
      "Tidak ada kode aktif. Tap 'Minta Kode' untuk minta yang baru.",
    );
  }
  if (active.failedAttempts >= FAILED_ATTEMPTS_LOCKOUT_THRESHOLD) {
    return fail(
      "LOCKED",
      "Kode terkunci karena terlalu banyak salah. Minta kode baru.",
    );
  }

  const matches = await bcrypt.compare(trimmed, active.codeHash);
  if (!matches) {
    await db
      .update(approvalCodes)
      .set({ failedAttempts: sql`${approvalCodes.failedAttempts} + 1` })
      .where(eq(approvalCodes.id, active.id));
    const left = FAILED_ATTEMPTS_LOCKOUT_THRESHOLD - active.failedAttempts - 1;
    return fail(
      "WRONG_CODE",
      left > 0
        ? `Kode salah. Sisa ${left} percobaan.`
        : "Kode salah. Kode terkunci — minta kode baru.",
    );
  }

  /* CAS: hanya konsumsi kalau baris ini MASIH belum terpakai. Dua kasir yang
   * submit kode sama bersamaan tidak boleh dua-duanya lolos. */
  const consumed = await db
    .update(approvalCodes)
    .set({ consumedAt: new Date(), consumedByUserId: session.user.id })
    .where(
      and(eq(approvalCodes.id, active.id), isNull(approvalCodes.consumedAt)),
    )
    .returning({ id: approvalCodes.id });

  if (consumed.length === 0) {
    return fail("ALREADY_USED", "Kode sudah dipakai. Minta kode baru.");
  }

  await logAudit({
    eventType: "approval_code.consume",
    userId: session.user.id,
    entityType: "approval_code",
    entityId: active.id,
    payload: {
      summary: `Kode compliment dipakai — ${active.reason}`,
      context: { actionType: "pos.compliment", reason: active.reason },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  }).catch((e) => console.error("[audit compliment.consume]", e));

  return ok({ approvedReason: active.reason, approvalCodeId: active.id });
}
