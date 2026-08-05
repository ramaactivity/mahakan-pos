"use server";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountingPeriods,
  chartOfAccounts,
  ingredients,
  journalEntries,
  journalLines,
  purchases,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import {
  createAccountSchema,
  deactivateAccountSchema,
  isNormalBalanceValid,
  updateAccountSchema,
} from "./schemas";
import {
  getAccountBalances,
  getAccountById,
  getAccountLedgerEntries,
  getAccountOpeningBalance,
  getCashFlowEntries,
  getCurrentPeriod,
  getJournalEntryById,
  listAccounts,
  listJournalEntries,
  listPeriods,
  countJournalEntriesByPeriod,
} from "./queries";
import {
  mapOpeningBalance,
  mapPeriodClose,
  type AccountBalance as PeriodCloseAccountBalance,
} from "./mapping";
import { recordJournal, resolveAccounts, validateLines } from "./posting";
import {
  buildBalanceSheet,
  buildCashFlowStatement,
  buildGeneralLedger,
  buildIncomeStatement,
  buildTrialBalance,
  buildLedgerAccountSummary,
  buildValidationReport,
  type BalanceSheetReport,
  type CashFlowStatement,
  type GeneralLedgerReport,
  type LedgerAccountSummaryReport,
  type IncomeStatementReport,
  type TrialBalanceReport,
  type ValidationReport,
} from "./reports";
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
  sourceType?: string;
  fromDate?: string;
  toDate?: string;
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

// ============================================================
// Sesi V — Cutover wizard (opening balance)
// ============================================================

export type CutoverPreflight = {
  /** Auto-computed persediaan value per section (sum ingredient.current_stock × cost_per_unit). */
  persediaanKitchen: number;
  persediaanBar: number;
  persediaanPendukung: number;
  /** Auto-computed hutang dagang (sum purchases status='pending_payment' totalAmount). */
  hutangDagang: number;
  /** True kalau opening balance sudah pernah di-post (ada journal entry sourceType='opening_balance'). */
  alreadyPosted: boolean;
};

export async function fetchCutoverPreflight(): Promise<
  ApiResult<CutoverPreflight>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.opening_balance.input")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat input opening balance");
  }

  // Persediaan per section.
  const ingRows = await db
    .select({
      section: ingredients.section,
      total: sql<string>`COALESCE(SUM(${ingredients.currentStock} * ${ingredients.costPerUnit}), 0)`,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, session.user.outletId),
        isNull(ingredients.deletedAt),
      ),
    )
    .groupBy(ingredients.section);

  let persediaanKitchen = 0;
  let persediaanBar = 0;
  let persediaanPendukung = 0;
  for (const r of ingRows) {
    const v = Math.round(Number(r.total));
    if (r.section === "kitchen") persediaanKitchen = v;
    else if (r.section === "bar") persediaanBar = v;
    else persediaanPendukung += v; // supporting + cleaning + null all roll into 1142
  }

  // Hutang dagang outstanding.
  const [hutangRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${purchases.totalAmount}), 0)`,
    })
    .from(purchases)
    .where(
      and(
        eq(purchases.outletId, session.user.outletId),
        eq(purchases.status, "pending_payment"),
      ),
    );
  const hutangDagang = Math.round(Number(hutangRow?.total ?? 0));

  // Already posted check.
  const [existing] = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, session.user.outletId),
        eq(journalEntries.sourceType, "opening_balance"),
        sql`${journalEntries.status} <> 'reversed'`,
      ),
    )
    .limit(1);

  return ok({
    persediaanKitchen,
    persediaanBar,
    persediaanPendukung,
    hutangDagang,
    alreadyPosted: Boolean(existing),
  });
}

export type PostOpeningBalanceInput = {
  /** YYYY-MM-DD. Defaults to "2026-05-31" untuk Mahakan cutover. */
  entryDate?: string;
  kasDrawer: number;
  kasBrankas: number;
  bankBca: number;
  bankBri: number;
  bankLain: number;
  piutangQris: number;
  piutangEdcBca: number;
  piutangGofood: number;
  piutangGrabfood: number;
  piutangShopeefood: number;
  biayaDibayarDimuka: number;
  modalOwner: number;
  saldoLaba: number;
  // Persediaan + hutang dagang resolved server-side via fetchCutoverPreflight
  // (Owner cannot override — auto from data).
};

export async function postOpeningBalance(
  input: PostOpeningBalanceInput,
): Promise<
  ApiResult<{ entryId: string; entryNumber: string; periodId: string }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.opening_balance.input")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat input opening balance");
  }

  const preflight = await fetchCutoverPreflight();
  if (!preflight.ok) return preflight as ApiResult<never>;
  if (preflight.data.alreadyPosted) {
    return fail(
      "ALREADY_POSTED",
      "Opening balance sudah pernah di-post. Reverse dulu kalau mau ganti.",
    );
  }

  const entryDate = input.entryDate ?? "2026-05-31";

  let lines;
  try {
    lines = mapOpeningBalance({
      outletId: session.user.outletId,
      entryDate,
      kasDrawer: input.kasDrawer,
      kasBrankas: input.kasBrankas,
      bankBca: input.bankBca,
      bankBri: input.bankBri,
      bankLain: input.bankLain,
      piutangQris: input.piutangQris,
      piutangEdcBca: input.piutangEdcBca,
      piutangGofood: input.piutangGofood,
      piutangGrabfood: input.piutangGrabfood,
      piutangShopeefood: input.piutangShopeefood,
      biayaDibayarDimuka: input.biayaDibayarDimuka,
      persediaanKitchen: preflight.data.persediaanKitchen,
      persediaanBar: preflight.data.persediaanBar,
      persediaanPendukung: preflight.data.persediaanPendukung,
      hutangDagang: preflight.data.hutangDagang,
      modalOwner: input.modalOwner,
      saldoLaba: input.saldoLaba,
    });
  } catch (e) {
    return fail("VALIDATION", logAndSanitize(e, "accounting", "Validasi gagal"));
  }

  let result;
  try {
    result = await recordJournal({
      outletId: session.user.outletId,
      entryDate,
      description: `Jurnal Pembukaan ${entryDate}`,
      sourceType: "opening_balance",
      sourceId: null,
      lines,
      actorId: session.user.id,
      metadata: {
        autoComputed: {
          persediaanKitchen: preflight.data.persediaanKitchen,
          persediaanBar: preflight.data.persediaanBar,
          persediaanPendukung: preflight.data.persediaanPendukung,
          hutangDagang: preflight.data.hutangDagang,
        },
        ownerInputs: input,
      },
    });
  } catch (e) {
    return fail("DB_ERROR", logAndSanitize(e, "accounting", "Operasi database gagal"));
  }

  // Auto-lock the period the opening balance was posted to.
  const [yyyy, mm] = entryDate.split("-");
  await db
    .update(accountingPeriods)
    .set({
      status: "locked",
      lockedAt: new Date(),
      lockedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(accountingPeriods.outletId, session.user.outletId),
        eq(accountingPeriods.periodYear, Number(yyyy)),
        eq(accountingPeriods.periodMonth, Number(mm)),
      ),
    );

  await logAudit({
    eventType: "opening_balance.posted",
    userId: session.user.id,
    entityType: "journal_entry",
    entityId: result.entryId,
    payload: {
      summary: `Jurnal Pembukaan ${entryDate} (${result.entryNumber})`,
      after: { entryId: result.entryId, entryNumber: result.entryNumber, lineCount: lines.length },
    },
  });

  return ok(result);
}

// ============================================================
// Sesi V — Period Close + Reopen + Lock
// ============================================================

export async function closeAccountingPeriod(
  periodId: string,
): Promise<ApiResult<{ entryId: string; entryNumber: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.period.close")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat tutup periode");
  }

  const [period] = await db
    .select()
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.id, periodId),
        eq(accountingPeriods.outletId, session.user.outletId),
      ),
    )
    .limit(1);
  if (!period) return fail("NOT_FOUND", "Periode tidak ditemukan");
  if (period.status !== "open") {
    return fail("INVALID_STATE", `Periode sudah ${period.status}`);
  }

  // Validate: no draft entries di period
  const [draftCount] = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.periodId, periodId),
        eq(journalEntries.status, "draft"),
      ),
    );
  if (Number(draftCount?.c ?? 0) > 0) {
    return fail(
      "HAS_DRAFTS",
      `${draftCount.c} entri draft belum di-post / discard. Bereskan dulu sebelum tutup periode.`,
    );
  }

  // Compute period bounds (last day of month untuk entry_date closing).
  const lastDay = new Date(
    period.periodYear,
    period.periodMonth, // next month, day 0 = last day this month
    0,
  )
    .toISOString()
    .slice(0, 10);
  const firstDay = `${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}-01`;

  // Aggregate balances dalam period only (entry.entryDate dalam window).
  const balances = await getAccountBalances({
    outletId: session.user.outletId,
    fromDate: firstDay,
    toDate: lastDay,
  });

  // Filter ke revenue/cogs/expense saja, normalize balance per type.
  const periodCloseBalances: PeriodCloseAccountBalance[] = [];
  for (const b of balances) {
    if (
      b.type !== "revenue" &&
      b.type !== "cogs" &&
      b.type !== "expense"
    ) {
      continue;
    }
    let normalized = 0;
    if (b.normalBalance === "debit") {
      normalized = b.debitTotal - b.creditTotal;
    } else {
      normalized = b.creditTotal - b.debitTotal;
    }
    if (normalized === 0) continue;
    periodCloseBalances.push({
      code: b.code,
      type: b.type,
      balance: normalized,
      accountId: b.accountId,
    });
  }

  if (periodCloseBalances.length === 0) {
    // Kalau period kosong, just mark closed without journal entry.
    await db
      .update(accountingPeriods)
      .set({
        status: "closed",
        closedAt: new Date(),
        closedBy: session.user.id,
        updatedAt: new Date(),
      })
      .where(eq(accountingPeriods.id, periodId));

    await logAudit({
      eventType: "accounting_period.close",
      userId: session.user.id,
      entityType: "accounting_period",
      entityId: periodId,
      payload: {
        summary: `Tutup periode ${period.periodYear}-${String(period.periodMonth).padStart(2, "0")} (kosong)`,
      },
    });

    return ok({ entryId: "", entryNumber: "" });
  }

  let lines;
  try {
    lines = mapPeriodClose({
      outletId: session.user.outletId,
      entryDate: lastDay,
      periodLabel: `${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}`,
      balances: periodCloseBalances,
    });
  } catch (e) {
    return fail("VALIDATION", logAndSanitize(e, "accounting", "Validasi gagal"));
  }

  let result;
  try {
    result = await recordJournal({
      outletId: session.user.outletId,
      entryDate: lastDay,
      description: `Closing entry ${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}`,
      sourceType: "period_close",
      sourceId: periodId,
      lines,
      actorId: session.user.id,
    });
  } catch (e) {
    return fail("DB_ERROR", logAndSanitize(e, "accounting", "Operasi database gagal"));
  }

  // Update period status
  await db
    .update(accountingPeriods)
    .set({
      status: "closed",
      closedAt: new Date(),
      closedBy: session.user.id,
      closingEntryId: result.entryId,
      updatedAt: new Date(),
    })
    .where(eq(accountingPeriods.id, periodId));

  await logAudit({
    eventType: "accounting_period.close",
    userId: session.user.id,
    entityType: "accounting_period",
    entityId: periodId,
    payload: {
      summary: `Tutup periode ${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}`,
      after: { closingEntryId: result.entryId, entryNumber: result.entryNumber },
    },
  });

  return ok(result);
}

/**
 * Sesi Y polish #6 — Bulk close periode lama (chronological enforced).
 * Closes semua open period yang lebih lama dari current month, in chronological
 * order. Stops on first error and reports progress.
 */
export async function bulkCloseHistoricalPeriods(): Promise<
  ApiResult<{
    closed: Array<{ periodLabel: string; entryNumber: string }>;
    failed: Array<{ periodLabel: string; error: string }>;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.period.close")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat tutup periode");
  }

  // Fetch all open periods ordered chronologically (oldest first)
  const allPeriods = await db
    .select()
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.outletId, session.user.outletId),
        eq(accountingPeriods.status, "open"),
      ),
    )
    .orderBy(
      asc(accountingPeriods.periodYear),
      asc(accountingPeriods.periodMonth),
    );

  // Determine current Jakarta year-month — skip current period (Owner closes
  // manually after month-end, not via bulk).
  const now = new Date();
  const jakartaTimeMs = now.getTime() + 7 * 60 * 60 * 1000;
  const j = new Date(jakartaTimeMs);
  const currentYear = j.getUTCFullYear();
  const currentMonth = j.getUTCMonth() + 1;

  const eligible = allPeriods.filter((p) => {
    if (p.periodYear < currentYear) return true;
    if (p.periodYear === currentYear && p.periodMonth < currentMonth)
      return true;
    return false;
  });

  if (eligible.length === 0) {
    return fail(
      "NO_PERIODS",
      "Tidak ada periode lama yang perlu di-tutup (current month tetap manual close)",
    );
  }

  const closed: Array<{ periodLabel: string; entryNumber: string }> = [];
  const failed: Array<{ periodLabel: string; error: string }> = [];

  for (const p of eligible) {
    const label = `${p.periodYear}-${String(p.periodMonth).padStart(2, "0")}`;
    try {
      const res = await closeAccountingPeriod(p.id);
      if (res.ok) {
        closed.push({ periodLabel: label, entryNumber: res.data.entryNumber });
      } else {
        failed.push({ periodLabel: label, error: res.error.message });
        // Stop on first failure — chronological close requires earlier
        // periods to settle first.
        break;
      }
    } catch (e) {
      failed.push({
        periodLabel: label,
        error: e instanceof Error ? e.message : String(e),
      });
      break;
    }
  }

  return ok({ closed, failed });
}

export async function reopenAccountingPeriod(
  periodId: string,
  reason: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.period.reopen")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat buka periode tertutup");
  }
  if (!reason || reason.trim().length < 10) {
    return fail("VALIDATION", "Alasan minimal 10 karakter");
  }

  const [period] = await db
    .select()
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.id, periodId),
        eq(accountingPeriods.outletId, session.user.outletId),
      ),
    )
    .limit(1);
  if (!period) return fail("NOT_FOUND", "Periode tidak ditemukan");
  if (period.status !== "closed") {
    return fail("INVALID_STATE", `Periode harus closed (saat ini ${period.status})`);
  }

  // Reverse closing entry kalau ada.
  if (period.closingEntryId) {
    const closingEntry = await getJournalEntryById(
      session.user.outletId,
      period.closingEntryId,
    );
    if (closingEntry && closingEntry.status === "posted") {
      // Build counter-entry (flip debit/credit).
      const counterLines = closingEntry.lines.map((l) => ({
        accountId: l.accountId,
        debit: Number(l.credit),
        credit: Number(l.debit),
        description: `Reverse: ${l.description ?? ""}`,
      }));
      try {
        const reverseResult = await recordJournal({
          outletId: session.user.outletId,
          entryDate: String(closingEntry.entryDate),
          description: `Reverse closing entry ${closingEntry.entryNumber} — ${reason}`,
          sourceType: "period_reopen",
          sourceId: closingEntry.id,
          lines: counterLines,
          actorId: session.user.id,
        });

        // Mark original closing as reversed
        await db
          .update(journalEntries)
          .set({
            status: "reversed",
            reversedByEntryId: reverseResult.entryId,
            reverseReason: reason,
            updatedAt: new Date(),
          })
          .where(eq(journalEntries.id, closingEntry.id));

        /* Pair-void: mark counter as 'reversed' + link reversesEntryId.
         * Tanpa ini, counter status='posted' tetap masuk ledger sum
         * sementara original excluded → net = -original. Pair-void
         * exclude keduanya → net = 0 (lihat reverseJournalEntry). */
        await db
          .update(journalEntries)
          .set({
            status: "reversed",
            reversesEntryId: closingEntry.id,
            updatedAt: new Date(),
          })
          .where(eq(journalEntries.id, reverseResult.entryId));
      } catch (e) {
        return fail("DB_ERROR", logAndSanitize(e, "accounting", "Operasi database gagal"));
      }
    }
  }

  // Re-open period
  await db
    .update(accountingPeriods)
    .set({
      status: "open",
      closedAt: null,
      closedBy: null,
      closingEntryId: null,
      notes: reason,
      updatedAt: new Date(),
    })
    .where(eq(accountingPeriods.id, periodId));

  await logAudit({
    eventType: "accounting_period.reopen",
    userId: session.user.id,
    entityType: "accounting_period",
    entityId: periodId,
    payload: {
      summary: `Buka kembali periode ${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}`,
      context: { reason },
    },
  });

  return ok({ id: periodId });
}

export async function lockAccountingPeriod(
  periodId: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.period.lock")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat lock periode");
  }

  const [period] = await db
    .select()
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.id, periodId),
        eq(accountingPeriods.outletId, session.user.outletId),
      ),
    )
    .limit(1);
  if (!period) return fail("NOT_FOUND", "Periode tidak ditemukan");
  if (period.status === "locked") {
    return fail("INVALID_STATE", "Periode sudah locked");
  }

  await db
    .update(accountingPeriods)
    .set({
      status: "locked",
      lockedAt: new Date(),
      lockedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(accountingPeriods.id, periodId));

  await logAudit({
    eventType: "accounting_period.lock",
    userId: session.user.id,
    entityType: "accounting_period",
    entityId: periodId,
    payload: {
      summary: `Kunci periode ${period.periodYear}-${String(period.periodMonth).padStart(2, "0")} (irreversible)`,
    },
  });

  return ok({ id: periodId });
}

// ============================================================
// Sesi V — Manual journal entry
// ============================================================

export type ManualJournalLineInput = {
  accountId: string;
  debit: number;
  credit: number;
  description?: string | null;
};

export type PostManualJournalInput = {
  entryDate: string;
  description: string;
  lines: ManualJournalLineInput[];
  /** Default 'posted' untuk Owner; Manager bisa save 'draft'. */
  status: "draft" | "posted";
};

export async function saveManualJournal(
  input: PostManualJournalInput,
): Promise<
  ApiResult<{ entryId: string; entryNumber: string; status: string }>
> {
  const session = await requireSession();

  if (input.status === "draft") {
    if (!hasPermission(session.user.role, "accounting.journal.draft")) {
      return fail("FORBIDDEN", "Tidak punya hak draft entry");
    }
  } else {
    if (!hasPermission(session.user.role, "accounting.journal.post")) {
      return fail("FORBIDDEN", "Hanya Owner yang dapat post entry manual");
    }
  }

  if (!input.description || input.description.trim().length < 3) {
    return fail("VALIDATION", "Deskripsi minimal 3 karakter");
  }
  if (!input.lines || input.lines.length < 2) {
    return fail("VALIDATION", "Entry minimal 2 baris");
  }

  // Lines validation: debit XOR credit, both >= 0
  for (const l of input.lines) {
    if (l.debit < 0 || l.credit < 0) {
      return fail("VALIDATION", "Nilai debit/credit tidak boleh negatif");
    }
    if ((l.debit > 0 && l.credit > 0) || (l.debit === 0 && l.credit === 0)) {
      return fail(
        "VALIDATION",
        "Setiap baris harus debit ATAU credit, bukan keduanya / kosong",
      );
    }
  }

  let result;
  try {
    result = await recordJournal({
      outletId: session.user.outletId,
      entryDate: input.entryDate,
      description: input.description.trim(),
      sourceType: "manual",
      sourceId: null,
      lines: input.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        description: l.description ?? null,
      })),
      status: input.status,
      actorId: session.user.id,
    });
  } catch (e) {
    return fail("DB_ERROR", logAndSanitize(e, "accounting", "Operasi database gagal"));
  }

  await logAudit({
    eventType:
      input.status === "draft" ? "journal_entry.draft" : "journal_entry.post",
    userId: session.user.id,
    entityType: "journal_entry",
    entityId: result.entryId,
    payload: {
      summary: `Entry manual ${result.entryNumber} (${input.status}) — ${input.description}`,
      after: { entryNumber: result.entryNumber, lineCount: input.lines.length },
    },
  });

  return ok({ ...result, status: input.status });
}

export async function reverseJournalEntry(
  entryId: string,
  reason: string,
): Promise<ApiResult<{ id: string; reverseEntryId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.journal.reverse")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat reverse entry");
  }
  if (!reason || reason.trim().length < 10) {
    return fail("VALIDATION", "Alasan reverse minimal 10 karakter");
  }

  const original = await getJournalEntryById(session.user.outletId, entryId);
  if (!original) return fail("NOT_FOUND", "Entry tidak ditemukan");
  if (original.status !== "posted") {
    return fail("INVALID_STATE", `Entry status ${original.status}, tidak bisa di-reverse`);
  }

  const counterLines = original.lines.map((l) => ({
    accountId: l.accountId,
    debit: Number(l.credit),
    credit: Number(l.debit),
    description: `Reverse: ${l.description ?? ""}`,
  }));

  let reverseResult;
  try {
    reverseResult = await recordJournal({
      outletId: session.user.outletId,
      entryDate: new Date().toISOString().slice(0, 10),
      description: `Reverse ${original.entryNumber} — ${reason}`,
      sourceType: original.sourceType,
      // Use distinct sourceId to avoid idempotency collision (append "-rev")
      sourceId: null,
      lines: counterLines,
      actorId: session.user.id,
      metadata: { reversesEntryId: original.id, reason },
    });
  } catch (e) {
    return fail("DB_ERROR", logAndSanitize(e, "accounting", "Operasi database gagal"));
  }

  // Mark original
  await db
    .update(journalEntries)
    .set({
      status: "reversed",
      reversedByEntryId: reverseResult.entryId,
      reverseReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(journalEntries.id, entryId));

  /* Mark counter-entry sebagai 'reversed' juga (pair void). Tanpa ini,
   * counter status='posted' tetap masuk getAccountBalances sum sementara
   * original di-exclude → net = -original (ledger salah arah). Dengan
   * pair-void, kedua sisi excluded → net = 0 (akuntansi benar). */
  await db
    .update(journalEntries)
    .set({
      reversesEntryId: entryId,
      status: "reversed",
      updatedAt: new Date(),
    })
    .where(eq(journalEntries.id, reverseResult.entryId));

  await logAudit({
    eventType: "journal_entry.reverse",
    userId: session.user.id,
    entityType: "journal_entry",
    entityId: entryId,
    payload: {
      summary: `Reverse ${original.entryNumber} — ${reason}`,
      context: { reverseEntryId: reverseResult.entryId, reason },
    },
  });

  return ok({ id: entryId, reverseEntryId: reverseResult.entryId });
}

/**
 * Sesi AE-63 phase4 — Hapus draft journal entry. Staff finance request:
 * "kita buat jurnal manual ada kesalahan pencatatan ada fitur untuk
 * edit/hapus".
 *
 * Posted entries TIDAK BISA di-delete (audit trail). Workflow:
 *  - Draft entry → boleh delete (belum masuk financial reports)
 *  - Posted entry → harus reverse (existing reverseJournalEntry)
 *
 * Guards:
 *  - Hanya pemilik permission accounting.journal.post (Owner)
 *  - Hanya entry dengan sourceType='manual' (system entries seperti
 *    pos_sale tidak boleh di-delete biar konsisten dengan source data)
 *  - Hanya status='draft'
 *  - outletId scope match
 *
 * Cascading: journal_lines.entry_id punya ON DELETE CASCADE → lines
 * otomatis ke-hapus saat entry di-delete.
 *
 * Sesi AE-76 — IMPORTANT: hard-delete entry BIKIN GAP di entry_number
 * sequence (mis. JE-0046, JE-0048 tanpa JE-0047). Algorithm
 * `recordJournal` sekarang pakai MAX(seq)+1 (bukan COUNT(*)+1) supaya
 * tidak collision setelah gap. Aman.
 */
export async function deleteDraftJournalEntry(
  entryId: string,
): Promise<ApiResult<{ deleted: true; entryNumber: string }>> {
  const session = await requireSession();
  /* Sesi AE-69 P1 — RBAC fix per feedback staff finance (Anisa). Sebelumnya
   * delete draft butuh `accounting.journal.post` (owner only) → staff finance
   * yang punya hak draft TIDAK BISA hapus draft sendiri yang dia buat → harus
   * eskalasi ke owner. Padahal draft belum mempengaruhi report, safe untuk
   * di-hapus oleh peran yang punya hak draft. Sekarang pakai `.draft`
   * permission (owner + manager). */
  if (!hasPermission(session.user.role, "accounting.journal.draft")) {
    return fail(
      "FORBIDDEN",
      "Tidak punya hak hapus draft journal entry",
    );
  }

  const original = await getJournalEntryById(session.user.outletId, entryId);
  if (!original) return fail("NOT_FOUND", "Entry tidak ditemukan");
  if (original.status !== "draft") {
    return fail(
      "INVALID_STATE",
      `Entry status ${original.status} — hanya draft yang bisa di-hapus. Posted entry harus di-reverse.`,
    );
  }
  if (original.sourceType !== "manual") {
    return fail(
      "INVALID_STATE",
      "Hanya entry manual yang bisa di-hapus. System entry harus melalui source-nya.",
    );
  }

  try {
    /* journal_lines.entry_id punya ON DELETE CASCADE — lines otomatis
     * ke-hapus saat entry di-delete. defense-in-depth outletId scope
     * di .where(). */
    await db
      .delete(journalEntries)
      .where(
        and(
          eq(journalEntries.id, entryId),
          eq(journalEntries.outletId, session.user.outletId),
          eq(journalEntries.status, "draft"),
        ),
      );
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "accounting", "Operasi database gagal"),
    );
  }

  await logAudit({
    eventType: "journal_entry.delete",
    userId: session.user.id,
    entityType: "journal_entry",
    entityId: entryId,
    payload: {
      summary: `Hapus draft ${original.entryNumber} — ${original.description}`,
      before: {
        entryNumber: original.entryNumber,
        description: original.description,
        lineCount: original.lines.length,
      },
    },
  });

  return ok({ deleted: true, entryNumber: original.entryNumber });
}

/**
 * Sesi AE-63 phase4 — Update draft journal entry in-place. Staff finance
 * request: edit draft kalau ada kesalahan pencatatan, tanpa harus
 * delete + recreate (yang akan ubah entry number).
 *
 * Atomicity: dalam satu transaction:
 *   1. Re-validate semua lines (accounts exist + XOR + balance)
 *   2. Update header (entryDate, description, status optional)
 *   3. Delete old lines
 *   4. Insert new lines dengan lineNumber baru
 *
 * Guards:
 *  - RBAC: status='draft' → accounting.journal.draft; status='posted' →
 *    accounting.journal.post (kalau update + post sekaligus, butuh hak post)
 *  - Hanya sourceType='manual' (system entries immutable)
 *  - Hanya entry status='draft' yang bisa di-edit. Posted → harus reverse.
 *  - outletId scope match (defense-in-depth)
 *
 * Entry number TIDAK berubah (preserve audit trail kalau staff pernah
 * forward ke owner sebelum edit).
 */
export type UpdateDraftJournalInput = {
  entryId: string;
  entryDate: string;
  description: string;
  lines: ManualJournalLineInput[];
  /** Optional — kalau di-set 'posted', sekalian transition status saat update.
   * Default tetap 'draft' (just save edits). */
  newStatus?: "draft" | "posted";
};

export async function updateDraftJournalEntry(
  input: UpdateDraftJournalInput,
): Promise<
  ApiResult<{ entryId: string; entryNumber: string; status: string }>
> {
  const session = await requireSession();
  const targetStatus = input.newStatus ?? "draft";

  if (targetStatus === "draft") {
    if (!hasPermission(session.user.role, "accounting.journal.draft")) {
      return fail("FORBIDDEN", "Tidak punya hak edit draft entry");
    }
  } else {
    if (!hasPermission(session.user.role, "accounting.journal.post")) {
      return fail("FORBIDDEN", "Hanya Owner yang dapat post entry");
    }
  }

  if (!input.description || input.description.trim().length < 3) {
    return fail("VALIDATION", "Deskripsi minimal 3 karakter");
  }
  if (!input.lines || input.lines.length < 2) {
    return fail("VALIDATION", "Entry minimal 2 baris");
  }
  for (const l of input.lines) {
    if (l.debit < 0 || l.credit < 0) {
      return fail("VALIDATION", "Nilai debit/credit tidak boleh negatif");
    }
    if ((l.debit > 0 && l.credit > 0) || (l.debit === 0 && l.credit === 0)) {
      return fail(
        "VALIDATION",
        "Setiap baris harus debit ATAU credit, bukan keduanya / kosong",
      );
    }
  }

  /* Fetch + validate target entry sebelum touch DB. */
  const original = await getJournalEntryById(
    session.user.outletId,
    input.entryId,
  );
  if (!original) return fail("NOT_FOUND", "Entry tidak ditemukan");
  if (original.status !== "draft") {
    return fail(
      "INVALID_STATE",
      `Entry status ${original.status} — hanya draft yang bisa di-edit. Posted entry harus di-reverse.`,
    );
  }
  if (original.sourceType !== "manual") {
    return fail(
      "INVALID_STATE",
      "Hanya entry manual yang bisa di-edit. System entry harus melalui source-nya.",
    );
  }

  /* Resolve + validate lines via shared posting helpers (DRY dengan
   * recordJournal). Throws kalau ada masalah, kita catch + map ke
   * structured error. */
  let resolved: Awaited<ReturnType<typeof resolveAccounts>>;
  try {
    resolved = await resolveAccounts(
      session.user.outletId,
      input.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        description: l.description ?? null,
      })),
    );
    validateLines(resolved);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("ACCOUNT_NOT_FOUND")) {
      return fail("VALIDATION", `Akun tidak ditemukan: ${msg.split(":")[1] ?? ""}`);
    }
    if (msg.startsWith("ACCOUNT_INACTIVE")) {
      return fail("VALIDATION", `Akun nonaktif: ${msg.split(":")[1] ?? ""}`);
    }
    if (msg.startsWith("JOURNAL_IMBALANCED")) {
      return fail("VALIDATION", "Debit tidak balance dengan credit");
    }
    return fail("VALIDATION", msg);
  }

  /* Apply update in transaction: header update + lines wipe + reinsert.
   * journal_lines.entry_id ON DELETE CASCADE, tapi kita pakai explicit
   * delete supaya bisa reinsert dengan urutan stabil. */
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(journalEntries)
        .set({
          entryDate: input.entryDate,
          description: input.description.trim(),
          status: targetStatus,
          postedAt: targetStatus === "posted" ? new Date() : null,
          postedBy: targetStatus === "posted" ? session.user.id : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(journalEntries.id, input.entryId),
            eq(journalEntries.outletId, session.user.outletId),
            eq(journalEntries.status, "draft"),
          ),
        );

      await tx
        .delete(journalLines)
        .where(eq(journalLines.entryId, input.entryId));

      const linesToInsert = resolved.map((l, idx) => ({
        entryId: input.entryId,
        lineNumber: idx + 1,
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
        metadata: l.metadata,
      }));
      await tx.insert(journalLines).values(linesToInsert);
    });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "accounting", "Operasi database gagal"),
    );
  }

  await logAudit({
    eventType:
      targetStatus === "posted"
        ? "journal_entry.post"
        : "journal_entry.update_draft",
    userId: session.user.id,
    entityType: "journal_entry",
    entityId: input.entryId,
    payload: {
      summary: `Edit ${original.entryNumber} (${targetStatus}) — ${input.description}`,
      before: {
        description: original.description,
        entryDate: original.entryDate,
        lineCount: original.lines.length,
      },
      after: {
        description: input.description.trim(),
        entryDate: input.entryDate,
        lineCount: input.lines.length,
      },
    },
  });

  return ok({
    entryId: input.entryId,
    entryNumber: original.entryNumber,
    status: targetStatus,
  });
}

// ============================================================
// Sesi V — Reports
// ============================================================

export async function fetchTrialBalance(args: {
  fromDate: string | null;
  toDate: string;
}): Promise<ApiResult<TrialBalanceReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.report.view")) {
    return fail("FORBIDDEN", "Tidak punya akses laporan akuntansi");
  }
  const balances = await getAccountBalances({
    outletId: session.user.outletId,
    fromDate: args.fromDate,
    toDate: args.toDate,
  });
  return ok(buildTrialBalance(balances));
}

/**
 * Sesi AE-183 — ringkasan saldo semua akun untuk tampilan awal Buku Besar
 * (sebelum owner memilih akun tertentu). Dua query: mutasi sebelum periode
 * (jadi saldo awal) + mutasi dalam periode. Hasilnya nyambung persis dengan
 * detail per akun karena memakai konvensi tanda yang sama.
 */
export async function fetchLedgerAccountSummary(args: {
  fromDate: string;
  toDate: string;
}): Promise<ApiResult<LedgerAccountSummaryReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.report.view")) {
    return fail("FORBIDDEN", "Tidak punya akses laporan akuntansi");
  }

  /* Saldo awal = seluruh mutasi sampai H-1 tanggal mulai. */
  const dayBefore = new Date(`${args.fromDate}T00:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const beforeIso = dayBefore.toISOString().slice(0, 10);

  const [opening, movement] = await Promise.all([
    getAccountBalances({
      outletId: session.user.outletId,
      fromDate: null,
      toDate: beforeIso,
    }),
    getAccountBalances({
      outletId: session.user.outletId,
      fromDate: args.fromDate,
      toDate: args.toDate,
    }),
  ]);

  return ok(buildLedgerAccountSummary({ opening, movement }));
}

export async function fetchIncomeStatement(args: {
  fromDate: string;
  toDate: string;
  periodLabel: string;
}): Promise<ApiResult<IncomeStatementReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.report.view")) {
    return fail("FORBIDDEN", "Tidak punya akses laporan akuntansi");
  }
  const balances = await getAccountBalances({
    outletId: session.user.outletId,
    fromDate: args.fromDate,
    toDate: args.toDate,
  });
  return ok(buildIncomeStatement(balances, args.periodLabel));
}

export async function fetchBalanceSheet(
  asOfDate: string,
): Promise<ApiResult<BalanceSheetReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.report.view")) {
    return fail("FORBIDDEN", "Tidak punya akses laporan akuntansi");
  }
  // Cumulative balances dari awal sampai asOfDate.
  const balances = await getAccountBalances({
    outletId: session.user.outletId,
    fromDate: null,
    toDate: asOfDate,
  });

  /* Sesi AE-63 phase4 — Bug fix: pre-fix `buildBalanceSheet(..., 0)` bikin
   * Neraca tidak balance kalau period belum di-close. Reason: period close
   * transfer 4xxx/5xxx/6xxx → 3302 → 3301 via closing entry. Sebelum close:
   * - 3302 di ledger = 0 (no closing entry yet)
   * - 4xxx/5xxx/6xxx di balances = running profit period berjalan
   * - L/R compute pakai 4xxx-5xxx-6xxx → ada angka
   * - Neraca tampil 3302=0 → tidak match L/R, total Equity ≠ (Assets-Liab)
   *
   * Fix: compute netIncome dari balances yang SAMA via buildIncomeStatement,
   * lalu inject ke 3302 di Neraca. Setelah close: revenue/expense balances=0
   * → netIncome=0 → 3302 stay 0, 3301 sudah punya transferred profit. ✓ */
  const incomeStatement = buildIncomeStatement(balances, "current");
  return ok(
    buildBalanceSheet(balances, asOfDate, incomeStatement.netIncome),
  );
}

/**
 * Sesi W (Field Validation) — fetch ledger balances + Finance source data
 * + compute drift report. Owner uses ini selama post-cutover monitoring
 * untuk detect kalau auto-journal hooks bug atau lupa post manual entry.
 */
export async function fetchValidationReport(
  asOfDate: string,
): Promise<ApiResult<ValidationReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.report.view")) {
    return fail("FORBIDDEN", "Tidak punya akses laporan akuntansi");
  }

  // Ledger side: aggregate journal_lines per code grouped.
  const balances = await getAccountBalances({
    outletId: session.user.outletId,
    fromDate: null,
    toDate: asOfDate,
  });
  const byCode = new Map(balances.map((b) => [b.code, b]));
  const balanceOf = (code: string) =>
    (byCode.get(code)?.debitTotal ?? 0) - (byCode.get(code)?.creditTotal ?? 0);
  const ledgerKas = balanceOf("1101") + balanceOf("1102");
  const ledgerPersediaanKitchen = balanceOf("1140");
  const ledgerPersediaanBar = balanceOf("1141");
  const ledgerPersediaanPendukung = balanceOf("1142");
  // Hutang Dagang credit-normal: positive balance = creditTotal - debitTotal.
  const ledgerHutang =
    (byCode.get("2101")?.creditTotal ?? 0)
    - (byCode.get("2101")?.debitTotal ?? 0);

  // Source side:
  // 1. Cash on hand — dynamic import dari finance/queries supaya barrel
  //    accounting tidak pull finance dependency.
  // Sesi AE-62f — cashOnHand sekarang exclude petty cash float (kasir laci
  // carryover). Ledger Kas Tunai 1101 include petty cash (dari opening
  // journal entry owner contribution), jadi source side = pettyCashFloat
  // + cashOnHand (depositable). Sebelumnya cashOnHand sudah include opening
  // sum (double-counted) — ledger validation kebetulan match by coincidence.
  const { getCashOnHand } = await import("@/features/finance/queries");
  const cashSnapshot = await getCashOnHand(session.user.outletId);
  const sourceCashOnHandStrict =
    cashSnapshot.cashOnHand + cashSnapshot.pettyCashFloat;

  // 2. Persediaan value per section (kitchen / bar / supporting+cleaning)
  const ingSections = await db
    .select({
      section: ingredients.section,
      total: sql<string>`COALESCE(SUM(${ingredients.currentStock} * ${ingredients.costPerUnit}), 0)`,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, session.user.outletId),
        isNull(ingredients.deletedAt),
      ),
    )
    .groupBy(ingredients.section);

  let sourceKitchen = 0;
  let sourceBar = 0;
  let sourcePendukung = 0;
  for (const r of ingSections) {
    const v = Math.round(Number(r.total));
    if (r.section === "kitchen") sourceKitchen = v;
    else if (r.section === "bar") sourceBar = v;
    else sourcePendukung += v; // supporting + cleaning + null
  }

  // 3. Hutang Dagang outstanding
  const [hutangRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${purchases.totalAmount}), 0)`,
    })
    .from(purchases)
    .where(
      and(
        eq(purchases.outletId, session.user.outletId),
        eq(purchases.status, "pending_payment"),
      ),
    );
  const sourceHutang = Math.round(Number(hutangRow?.total ?? 0));

  return ok(
    buildValidationReport({
      asOfDate,
      ledger: {
        kasTunai: ledgerKas,
        persediaanKitchen: ledgerPersediaanKitchen,
        persediaanBar: ledgerPersediaanBar,
        persediaanPendukung: ledgerPersediaanPendukung,
        hutangDagang: ledgerHutang,
      },
      source: {
        cashOnHand: sourceCashOnHandStrict,
        persediaanKitchen: sourceKitchen,
        persediaanBar: sourceBar,
        persediaanPendukung: sourcePendukung,
        hutangDagangPending: sourceHutang,
      },
    }),
  );
}

/**
 * Sesi Y polish — Cash Flow Statement (PSAK standar 3-section).
 */
export async function fetchCashFlowStatement(args: {
  fromDate: string;
  toDate: string;
  periodLabel: string;
}): Promise<ApiResult<CashFlowStatement>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.report.view")) {
    return fail("FORBIDDEN", "Tidak punya akses laporan akuntansi");
  }

  // Opening cash balance = balance per cash/bank accounts as-of (fromDate - 1)
  const openingBalances = await getAccountBalances({
    outletId: session.user.outletId,
    fromDate: null,
    toDate: prevDayIso(args.fromDate),
  });
  const openingCash = sumCashAccounts(openingBalances);

  // Closing cash balance actual (cumulative as-of toDate)
  const closingBalances = await getAccountBalances({
    outletId: session.user.outletId,
    fromDate: null,
    toDate: args.toDate,
  });
  const closingCashActual = sumCashAccounts(closingBalances);

  // Aggregate cash flow entries dalam range
  const entries = await getCashFlowEntries({
    outletId: session.user.outletId,
    fromDate: args.fromDate,
    toDate: args.toDate,
  });

  return ok(
    buildCashFlowStatement({
      periodLabel: args.periodLabel,
      openingCash,
      closingCashActual,
      entries,
    }),
  );
}

function prevDayIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function sumCashAccounts(
  balances: Array<{ code: string; debitTotal: number; creditTotal: number }>,
): number {
  const cashCodes = ["1101", "1102", "1110", "1111", "1112"];
  return balances
    .filter((b) => cashCodes.includes(b.code))
    .reduce((s, b) => s + (b.debitTotal - b.creditTotal), 0);
}

export async function fetchGeneralLedger(args: {
  accountId: string;
  fromDate: string;
  toDate: string;
}): Promise<ApiResult<GeneralLedgerReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.report.view")) {
    return fail("FORBIDDEN", "Tidak punya akses laporan akuntansi");
  }

  const account = await getAccountById(session.user.outletId, args.accountId);
  if (!account) return fail("NOT_FOUND", "Akun tidak ditemukan");

  const opening = await getAccountOpeningBalance({
    outletId: session.user.outletId,
    accountId: args.accountId,
    beforeDate: args.fromDate,
  });

  // Normalize opening balance per normalBalance.
  const openingNormalized =
    account.normalBalance === "debit" ? opening : -opening;

  const entries = await getAccountLedgerEntries({
    outletId: session.user.outletId,
    accountId: args.accountId,
    fromDate: args.fromDate,
    toDate: args.toDate,
  });

  return ok(
    buildGeneralLedger({
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type as
        | "asset"
        | "liability"
        | "equity"
        | "revenue"
        | "cogs"
        | "expense",
      normalBalance: account.normalBalance as "debit" | "credit",
      openingBalance: openingNormalized,
      entries,
    }),
  );
}
