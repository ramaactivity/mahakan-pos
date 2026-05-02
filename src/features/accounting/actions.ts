"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods, chartOfAccounts } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import {
  createAccountSchema,
  deactivateAccountSchema,
  isNormalBalanceValid,
  updateAccountSchema,
} from "./schemas";
import {
  getAccountById,
  getCurrentPeriod,
  listAccounts,
  listJournalEntries,
  listPeriods,
  countJournalEntriesByPeriod,
} from "./queries";
import {
  fail,
  ok,
  type AccountListRow,
  type AccountType,
  type AccountingPeriod,
  type ApiResult,
  type ChartOfAccount,
  type JournalEntryWithLines,
  type PeriodSummary,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

// ============================================================
// READ wrappers (RBAC-checked)
// ============================================================

export async function fetchAccounts(filters?: {
  type?: AccountType;
  isActive?: boolean;
}): Promise<ApiResult<AccountListRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.coa.view")) {
    return fail("FORBIDDEN", "Tidak punya akses Bagan Akun");
  }
  const rows = await listAccounts(session.user.outletId, filters);
  return ok(rows);
}

export async function fetchPeriods(): Promise<ApiResult<PeriodSummary[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.period.view")) {
    return fail("FORBIDDEN", "Tidak punya akses periode akuntansi");
  }
  const rows = await listPeriods(session.user.outletId);
  return ok(rows);
}

export async function fetchCurrentPeriod(): Promise<
  ApiResult<AccountingPeriod | null>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.period.view")) {
    return fail("FORBIDDEN", "Tidak punya akses periode akuntansi");
  }
  const row = await getCurrentPeriod(session.user.outletId);
  return ok(row);
}

export async function fetchJournalEntries(filters?: {
  periodId?: string;
  status?: "draft" | "posted" | "reversed";
  limit?: number;
  offset?: number;
}): Promise<ApiResult<JournalEntryWithLines[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.journal.view")) {
    return fail("FORBIDDEN", "Tidak punya akses jurnal");
  }
  const rows = await listJournalEntries(session.user.outletId, filters);
  return ok(rows);
}

export async function fetchPeriodStats(
  periodId: string,
): Promise<ApiResult<{ posted: number; draft: number; reversed: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.journal.view")) {
    return fail("FORBIDDEN", "Tidak punya akses jurnal");
  }
  const stats = await countJournalEntriesByPeriod(session.user.outletId, periodId);
  return ok(stats);
}

// ============================================================
// Period auto-create (utility for sesi T+ but exposed for UI)
// ============================================================

/**
 * Idempotent: returns existing period for current Jakarta month, atau create
 * baru kalau belum ada. Owner+manager bisa trigger via UI "Buat Periode Bulan Ini".
 */
export async function ensureCurrentPeriod(): Promise<
  ApiResult<AccountingPeriod>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.period.view")) {
    return fail("FORBIDDEN", "Tidak punya akses periode akuntansi");
  }

  const existing = await getCurrentPeriod(session.user.outletId);
  if (existing) return ok(existing);

  const now = new Date();
  const jakartaTimeMs = now.getTime() + 7 * 60 * 60 * 1000;
  const j = new Date(jakartaTimeMs);
  const year = j.getUTCFullYear();
  const month = j.getUTCMonth() + 1;

  const [created] = await db
    .insert(accountingPeriods)
    .values({
      outletId: session.user.outletId,
      periodYear: year,
      periodMonth: month,
      status: "open",
    })
    .returning();

  await logAudit({
    eventType: "accounting_period.open",
    userId: session.user.id,
    entityType: "accounting_period",
    entityId: created.id,
    payload: {
      summary: `Buka periode ${year}-${String(month).padStart(2, "0")}`,
      after: created,
    },
  });

  return ok(created);
}

// ============================================================
// Chart of Accounts CRUD (Owner-only manage)
// ============================================================

export async function createAccount(
  raw: unknown,
): Promise<ApiResult<ChartOfAccount>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.coa.manage")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat mengelola Bagan Akun");
  }

  const parsed = createAccountSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Input tidak valid");
  }
  const v = parsed.data;

  if (!isNormalBalanceValid(v.type, v.normalBalance, v.isContra)) {
    return fail(
      "VALIDATION",
      v.isContra
        ? `Akun kontra ${v.type} harus normal balance ${v.normalBalance === "debit" ? "credit" : "debit"}`
        : `Akun ${v.type} harus normal balance ${v.normalBalance === "debit" ? "debit" : "credit"}`,
    );
  }

  // Cek duplicate code (active row)
  const [existing] = await db
    .select({ id: chartOfAccounts.id })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.outletId, session.user.outletId),
        eq(chartOfAccounts.code, v.code),
        isNull(chartOfAccounts.deletedAt),
      ),
    )
    .limit(1);
  if (existing) {
    return fail("DUPLICATE", `Kode akun ${v.code} sudah ada`);
  }

  const [created] = await db
    .insert(chartOfAccounts)
    .values({
      outletId: session.user.outletId,
      code: v.code,
      name: v.name,
      type: v.type,
      normalBalance: v.normalBalance,
      parentCode: v.parentCode,
      isContra: v.isContra,
      isSystem: false, // Owner-created akun selalu non-system
      isActive: true,
      displayOrder: v.displayOrder,
      notes: v.notes,
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning();

  await logAudit({
    eventType: "chart_of_accounts.create",
    userId: session.user.id,
    entityType: "chart_of_accounts",
    entityId: created.id,
    payload: {
      summary: `Tambah akun ${created.code} ${created.name}`,
      after: created,
    },
  });

  return ok(created);
}

export async function updateAccount(
  raw: unknown,
): Promise<ApiResult<ChartOfAccount>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.coa.manage")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat mengelola Bagan Akun");
  }

  const parsed = updateAccountSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Input tidak valid");
  }
  const v = parsed.data;

  const before = await getAccountById(session.user.outletId, v.id);
  if (!before) return fail("NOT_FOUND", "Akun tidak ditemukan");

  // System accounts: hanya displayOrder + notes yang boleh diubah
  if (before.isSystem) {
    const allowedKeys = ["displayOrder", "notes"] as const;
    const attemptedKeys = Object.keys(v).filter(
      (k) =>
        k !== "id" &&
        v[k as keyof typeof v] !== undefined &&
        !allowedKeys.includes(k as (typeof allowedKeys)[number]),
    );
    if (attemptedKeys.length > 0) {
      return fail(
        "FORBIDDEN_SYSTEM",
        `Akun sistem (${before.code}) hanya boleh edit display order + catatan. Attempted: ${attemptedKeys.join(", ")}`,
      );
    }
  }

  const updates: Partial<ChartOfAccount> = {
    updatedAt: new Date(),
    updatedBy: session.user.id,
  };
  if (v.name !== undefined) updates.name = v.name;
  if (v.parentCode !== undefined) updates.parentCode = v.parentCode;
  if (v.displayOrder !== undefined) updates.displayOrder = v.displayOrder;
  if (v.notes !== undefined) updates.notes = v.notes;
  if (v.isActive !== undefined) updates.isActive = v.isActive;

  const [updated] = await db
    .update(chartOfAccounts)
    .set(updates)
    .where(eq(chartOfAccounts.id, v.id))
    .returning();

  await logAudit({
    eventType: "chart_of_accounts.update",
    userId: session.user.id,
    entityType: "chart_of_accounts",
    entityId: updated.id,
    payload: {
      summary: `Edit akun ${updated.code} ${updated.name}`,
      before,
      after: updated,
    },
  });

  return ok(updated);
}

export async function deactivateAccount(
  raw: unknown,
): Promise<ApiResult<ChartOfAccount>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.coa.manage")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat mengelola Bagan Akun");
  }

  const parsed = deactivateAccountSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Input tidak valid");
  }

  const before = await getAccountById(session.user.outletId, parsed.data.id);
  if (!before) return fail("NOT_FOUND", "Akun tidak ditemukan");
  if (before.isSystem) {
    return fail("FORBIDDEN_SYSTEM", `Akun sistem (${before.code}) tidak dapat dinonaktifkan`);
  }

  const [updated] = await db
    .update(chartOfAccounts)
    .set({
      isActive: false,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(chartOfAccounts.id, parsed.data.id))
    .returning();

  await logAudit({
    eventType: "chart_of_accounts.deactivate",
    userId: session.user.id,
    entityType: "chart_of_accounts",
    entityId: updated.id,
    payload: {
      summary: `Nonaktifkan akun ${updated.code} ${updated.name}`,
      before,
      after: updated,
    },
  });

  return ok(updated);
}
