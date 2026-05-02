"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
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
import { recordJournal } from "./posting";
import {
  buildBalanceSheet,
  buildGeneralLedger,
  buildIncomeStatement,
  buildTrialBalance,
  type BalanceSheetReport,
  type GeneralLedgerReport,
  type IncomeStatementReport,
  type TrialBalanceReport,
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
    const msg = e instanceof Error ? e.message : "Mapping error";
    return fail("VALIDATION", msg);
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
    const msg = e instanceof Error ? e.message : "Database error";
    return fail("DB_ERROR", msg);
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
    const msg = e instanceof Error ? e.message : "Mapping error";
    return fail("VALIDATION", msg);
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
    const msg = e instanceof Error ? e.message : "Database error";
    return fail("DB_ERROR", msg);
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
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Database error";
        return fail("DB_ERROR", msg);
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
    const msg = e instanceof Error ? e.message : "Database error";
    return fail("DB_ERROR", msg);
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
    const msg = e instanceof Error ? e.message : "Database error";
    return fail("DB_ERROR", msg);
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

  // Mark reverse entry as a reversal pointer
  await db
    .update(journalEntries)
    .set({ reversesEntryId: entryId })
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

  // Compute net income current period (3302 includes only revenue/expense
  // in periods belum closed). Since 3302 line itself in balances reflects
  // closing-entry transfers + manual posts, we trust DB. Pass 0 untuk now.
  return ok(buildBalanceSheet(balances, asOfDate, 0));
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
