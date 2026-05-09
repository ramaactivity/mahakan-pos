"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bankAccounts } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import {
  fail,
  ok,
  type ApiResult,
  type BankAccount,
  type CreateBankAccountInput,
  type UpdateBankAccountInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

const createSchema = z.object({
  bankName: z.string().trim().min(1, "Nama bank wajib").max(80),
  accountName: z.string().trim().min(1, "Nama pemilik wajib").max(120),
  accountNumber: z.string().trim().max(40).default(""),
  notes: z.string().trim().max(200).nullish(),
  displayOrder: z.number().int().min(0).max(999).optional().default(0),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  bankName: z.string().trim().min(1).max(80).optional(),
  accountName: z.string().trim().min(1).max(120).optional(),
  accountNumber: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(200).nullish(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

/**
 * Sesi AE-13 — list bank accounts master untuk dropdown selector. Default
 * filter active=true; Settings page bisa pass includeInactive=true.
 * Sorted by displayOrder ASC, lalu createdAt ASC.
 */
export async function listBankAccounts(opts?: {
  includeInactive?: boolean;
}): Promise<ApiResult<BankAccount[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "bank_account.view")) {
    return fail("FORBIDDEN", "Tidak punya akses rekening bank");
  }
  const conds = [
    eq(bankAccounts.outletId, session.user.outletId),
    isNull(bankAccounts.deletedAt),
  ];
  if (!opts?.includeInactive) {
    conds.push(eq(bankAccounts.isActive, true));
  }
  const rows = await db
    .select()
    .from(bankAccounts)
    .where(and(...conds))
    .orderBy(asc(bankAccounts.displayOrder), asc(bankAccounts.createdAt));
  return ok(rows);
}

export async function createBankAccount(
  input: CreateBankAccountInput,
): Promise<ApiResult<BankAccount>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "bank_account.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak kelola rekening bank");
  }
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid");
  }
  try {
    const [row] = await db
      .insert(bankAccounts)
      .values({
        outletId: session.user.outletId,
        bankName: parsed.data.bankName,
        accountName: parsed.data.accountName,
        accountNumber: parsed.data.accountNumber,
        notes: parsed.data.notes ?? null,
        displayOrder: parsed.data.displayOrder,
        createdBy: session.user.id,
        updatedBy: session.user.id,
      })
      .returning();

    logAudit({
      eventType: "bank_account.create",
      userId: session.user.id,
      entityType: "bank_account",
      entityId: row.id,
      payload: {
        summary: `Tambah rekening ${row.bankName} — ${row.accountName}`,
        after: row,
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit bank_account.create]", e));

    return ok(row);
  } catch (e) {
    if (e instanceof Error && /unique|duplicate/i.test(e.message)) {
      return fail("DUPLICATE", "Rekening dengan nama + nomor sama sudah ada");
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "bank_account.create", "Gagal menyimpan rekening"),
    );
  }
}

export async function updateBankAccount(
  input: UpdateBankAccountInput,
): Promise<ApiResult<BankAccount>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "bank_account.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak kelola rekening bank");
  }
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid");
  }
  const v = parsed.data;
  const [current] = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.id, v.id))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Rekening tidak ditemukan");
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Rekening dari outlet lain");
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy: session.user.id,
  };
  if (v.bankName !== undefined) updates.bankName = v.bankName;
  if (v.accountName !== undefined) updates.accountName = v.accountName;
  if (v.accountNumber !== undefined) updates.accountNumber = v.accountNumber;
  if (v.notes !== undefined) updates.notes = v.notes;
  if (v.displayOrder !== undefined) updates.displayOrder = v.displayOrder;
  if (v.isActive !== undefined) updates.isActive = v.isActive;

  try {
    const [row] = await db
      .update(bankAccounts)
      .set(updates)
      .where(eq(bankAccounts.id, v.id))
      .returning();

    logAudit({
      eventType: "bank_account.update",
      userId: session.user.id,
      entityType: "bank_account",
      entityId: row.id,
      payload: {
        summary: `Update rekening ${row.bankName} — ${row.accountName}`,
        before: current,
        after: row,
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit bank_account.update]", e));

    return ok(row);
  } catch (e) {
    if (e instanceof Error && /unique|duplicate/i.test(e.message)) {
      return fail("DUPLICATE", "Rekening dengan nama + nomor sama sudah ada");
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "bank_account.update", "Gagal update rekening"),
    );
  }
}

export async function deleteBankAccount(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "bank_account.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak hapus rekening");
  }
  const [current] = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.id, id))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Rekening tidak ditemukan");
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Rekening dari outlet lain");
  }
  if (current.deletedAt) return ok({ id });

  await db
    .update(bankAccounts)
    .set({
      deletedAt: new Date(),
      isActive: false,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(bankAccounts.id, id));

  logAudit({
    eventType: "bank_account.delete",
    userId: session.user.id,
    entityType: "bank_account",
    entityId: id,
    payload: {
      summary: `Hapus rekening ${current.bankName} — ${current.accountName}`,
      before: current,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit bank_account.delete]", e));

  return ok({ id });
}
