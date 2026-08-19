"use server";

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountingPeriods,
  chartOfAccounts,
  employeeAdvances,
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
import {
  collectPeriodCloseBalances,
  periodBalanceCheck,
  periodBounds,
  periodLabelId,
  summarizeClosingNominals,
  type ClosingNominalAccount,
} from "./closing-pure";
import {
  adjustmentKindLabel,
  isAdjustmentKind,
  type AdjustmentKind,
} from "./adjusting-pure";
import {
  formatJournalEntryNumber,
  isDifferentPeriod,
  journalSeqLockKey,
  recordJournal,
  resolveAccounts,
  validateLines,
} from "./posting";
import { normalizeReceiptUrl } from "./receipt-url";
import {
  RETAINED_EARNINGS_CODE,
  OpeningBalanceError,
  buildOpeningBalanceLines,
  linesToNaturalAmounts,
  type OpeningAccountInput,
} from "./opening-balance-pure";
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
  type PeriodStatus,
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
// Sesi AE-207 — UBAH SALDO AWAL (langsung ketik nominal riil)
// ============================================================

export type OpeningBalanceEditorAccount = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  normalBalance: "debit" | "credit";
  isContra: boolean;
  /** Nilai tersimpan sekarang, arah normal akun, 0 kalau belum ada. */
  amount: number;
};

export type OpeningBalanceEditorData = {
  /** null = saldo awal belum pernah di-post. */
  entryId: string | null;
  entryNumber: string | null;
  entryDate: string | null;
  /** Akun yang SUDAH punya nilai — ditampilkan sebagai baris form. */
  filled: OpeningBalanceEditorAccount[];
  /** Semua akun neraca aktif, untuk menu "tambah akun". */
  available: OpeningBalanceEditorAccount[];
  retainedCode: string;
  /** Nilai 3301 sekarang (dihitung sistem, read-only di UI). */
  retainedAmount: number;
};

/**
 * Baca saldo awal yang berlaku, dalam bentuk "nilai riil per akun".
 *
 * Sengaja TIDAK memakai `getAccountBalances` (yang sudah ikut batas buku):
 * yang dibutuhkan di sini adalah isi jurnal Saldo Awal itu sendiri, bukan
 * saldo berjalan yang sudah tercampur mutasi periode baru.
 */
export async function fetchOpeningBalanceEditor(): Promise<
  ApiResult<OpeningBalanceEditorData>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.opening_balance.input")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat ubah saldo awal");
  }
  const outletId = session.user.outletId;

  const balanceSheetAccounts = await db
    .select({
      accountId: chartOfAccounts.id,
      code: chartOfAccounts.code,
      name: chartOfAccounts.name,
      type: chartOfAccounts.type,
      normalBalance: chartOfAccounts.normalBalance,
      isContra: chartOfAccounts.isContra,
    })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.outletId, outletId),
        isNull(chartOfAccounts.deletedAt),
        eq(chartOfAccounts.isActive, true),
        sql`${chartOfAccounts.type} IN ('asset', 'liability', 'equity')`,
      ),
    )
    .orderBy(asc(chartOfAccounts.code));

  const available: OpeningBalanceEditorAccount[] = balanceSheetAccounts.map(
    (a) => ({
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      type: a.type,
      normalBalance: a.normalBalance as "debit" | "credit",
      isContra: a.isContra,
      amount: 0,
    }),
  );

  const [entry] = await db
    .select({
      id: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      entryDate: journalEntries.entryDate,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, outletId),
        eq(journalEntries.sourceType, "opening_balance"),
        sql`${journalEntries.status} <> 'reversed'`,
      ),
    )
    .limit(1);

  if (!entry) {
    return ok({
      entryId: null,
      entryNumber: null,
      entryDate: null,
      filled: [],
      available,
      retainedCode: RETAINED_EARNINGS_CODE,
      retainedAmount: 0,
    });
  }

  const rawLines = await db
    .select({
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      normalBalance: chartOfAccounts.normalBalance,
    })
    .from(journalLines)
    .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalLines.accountId))
    .where(eq(journalLines.entryId, entry.id));

  const natural = linesToNaturalAmounts(
    rawLines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      normalBalance: l.normalBalance as "debit" | "credit",
    })),
  );

  const byId = new Map(available.map((a) => [a.accountId, a]));
  const filled: OpeningBalanceEditorAccount[] = [];
  let retainedAmount = 0;
  for (const [accountId, amount] of natural) {
    const acc = byId.get(accountId);
    if (!acc) continue; // akun sudah dinonaktifkan/dihapus — jangan tawarkan
    if (acc.code === RETAINED_EARNINGS_CODE) {
      retainedAmount = amount;
      continue;
    }
    if (amount === 0) continue;
    filled.push({ ...acc, amount });
  }
  filled.sort((a, b) => a.code.localeCompare(b.code));

  return ok({
    entryId: entry.id,
    entryNumber: entry.entryNumber,
    entryDate: String(entry.entryDate),
    filled,
    available,
    retainedCode: RETAINED_EARNINGS_CODE,
    retainedAmount,
  });
}

/**
 * Simpan saldo awal baru = BATALKAN yang lama lalu POST ulang.
 *
 * Kenapa bukan meng-UPDATE baris jurnal yang sudah ter-post: di sistem ini
 * jurnal ter-post itu tidak boleh diubah di tempat — semua perubahan lewat
 * pair-void (entry lama + lawannya sama-sama ditandai 'reversed') supaya
 * jejaknya bisa ditelusuri. Layar ini mengikuti aturan yang sama, jadi riwayat
 * "dulu saldo awalnya berapa" tetap ada di Jurnal.
 */
export async function saveOpeningBalance(input: {
  /** YYYY-MM-DD. */
  entryDate: string;
  /** Nilai riil per akun (positif, arah normal akun). Akun tak disebut = 0. */
  amounts: Array<{ accountId: string; amount: number }>;
  reason?: string;
}): Promise<
  ApiResult<{
    entryId: string;
    entryNumber: string;
    totalDebit: number;
    retainedPlug: number;
    replacedEntryNumber: string | null;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.opening_balance.input")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat ubah saldo awal");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) {
    return fail("VALIDATION", "Tanggal saldo awal harus format YYYY-MM-DD");
  }
  if (!Array.isArray(input.amounts) || input.amounts.length === 0) {
    return fail("VALIDATION", "Belum ada nilai yang diisi");
  }

  const outletId = session.user.outletId;

  // Resolve akun + pastikan semuanya akun NERACA yang aktif.
  const accounts = await db
    .select({
      id: chartOfAccounts.id,
      code: chartOfAccounts.code,
      type: chartOfAccounts.type,
      normalBalance: chartOfAccounts.normalBalance,
    })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.outletId, outletId),
        isNull(chartOfAccounts.deletedAt),
        eq(chartOfAccounts.isActive, true),
      ),
    );
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const inputs: OpeningAccountInput[] = [];
  for (const row of input.amounts) {
    const acc = byId.get(row.accountId);
    if (!acc) {
      return fail("VALIDATION", "Ada akun yang tidak dikenal / sudah nonaktif");
    }
    if (!["asset", "liability", "equity"].includes(acc.type)) {
      /* Akun pendapatan/beban tidak punya "saldo awal" — saldonya nol tiap
       * awal tahun buku. Kalau dibiarkan masuk, Laba Rugi periode baru
       * langsung terisi angka yang bukan hasil operasional. */
      return fail(
        "VALIDATION",
        `Akun ${acc.code} bukan akun neraca — saldo awal hanya untuk aset, kewajiban, dan modal.`,
      );
    }
    inputs.push({
      accountId: acc.id,
      code: acc.code,
      normalBalance: acc.normalBalance as "debit" | "credit",
      amount: Math.round(Number(row.amount) || 0),
    });
  }

  const retained = accounts.find((a) => a.code === RETAINED_EARNINGS_CODE);

  let built;
  try {
    built = buildOpeningBalanceLines(inputs, retained?.id ?? "");
  } catch (e) {
    if (e instanceof OpeningBalanceError) return fail("VALIDATION", e.message);
    throw e;
  }

  // Entry lama (kalau ada) dibatalkan dulu.
  const [existing] = await db
    .select({
      id: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, outletId),
        eq(journalEntries.sourceType, "opening_balance"),
        sql`${journalEntries.status} <> 'reversed'`,
      ),
    )
    .limit(1);

  if (existing) {
    const reversed = await reverseJournalEntry(
      existing.id,
      `Saldo awal disesuaikan dengan data fisik${input.reason ? ` — ${input.reason}` : ""}`,
    );
    if (!reversed.ok) {
      /* Teruskan apa adanya: pesan "periode terkunci"/"periode closed" dari
       * reverse justru yang paling berguna buat owner. */
      return reversed as ApiResult<never>;
    }
  }

  let result;
  try {
    result = await recordJournal({
      outletId,
      entryDate: input.entryDate,
      description: `Saldo Awal ${input.entryDate}${input.reason ? ` — ${input.reason}` : ""}`,
      sourceType: "opening_balance",
      sourceId: null,
      lines: built.lines,
      actorId: session.user.id,
      metadata: {
        replacedEntryId: existing?.id ?? null,
        replacedEntryNumber: existing?.entryNumber ?? null,
        retainedPlug: built.retainedPlug,
        reason: input.reason ?? null,
        setBy: "opening-balance-editor",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.startsWith("PERIOD_LOCKED")) {
      return fail(
        "PERIOD_LOCKED",
        `Periode ${msg.split(":")[1] ?? ""} sudah dikunci — buka kuncinya dulu di Akuntansi → Periode.`,
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "accounting", "Gagal menyimpan saldo awal"),
    );
  }

  await logAudit({
    eventType: "opening_balance.posted",
    userId: session.user.id,
    entityType: "journal_entry",
    entityId: result.entryId,
    payload: {
      summary: `Saldo Awal ${input.entryDate} disesuaikan (${result.entryNumber})`,
      before: existing
        ? { entryId: existing.id, entryNumber: existing.entryNumber }
        : null,
      after: {
        entryId: result.entryId,
        entryNumber: result.entryNumber,
        lineCount: built.lines.length,
        totalDebit: built.totalDebit,
        retainedPlug: built.retainedPlug,
      },
      context: { reason: input.reason ?? null },
    },
    metadata: { outletId, actorRole: session.user.role },
  });

  return ok({
    entryId: result.entryId,
    entryNumber: result.entryNumber,
    totalDebit: built.totalDebit,
    retainedPlug: built.retainedPlug,
    replacedEntryNumber: existing?.entryNumber ?? null,
  });
}

// ============================================================
// Sesi V — Period Close + Reopen + Lock
// ============================================================

/* ============================================================
 * Sesi AE-211 — Pratinjau Tutup Buku Bulanan
 *
 * Sebelum ini tombol "Tutup Periode" adalah lompatan buta: owner menekan,
 * jurnal penutup terbentuk, dan baru sesudahnya bisa dilihat apa isinya.
 * Fungsi ini menghitung persis apa yang AKAN terjadi — akun nominal mana yang
 * dinolkan, berapa laba/ruginya, jurnal penutupnya seperti apa — tanpa
 * menulis apa pun, plus daftar penghalang & peringatan.
 *
 * Angkanya dijamin sama dengan hasil `closeAccountingPeriod` karena keduanya
 * memakai `collectPeriodCloseBalances` + `mapPeriodClose` yang sama.
 * ============================================================ */

export type ClosingCheckItem = {
  code: string;
  message: string;
};

export type PeriodClosePreview = {
  periodId: string;
  periodYear: number;
  periodMonth: number;
  periodLabel: string;
  status: PeriodStatus;
  firstDay: string;
  lastDay: string;
  /** Akun nominal yang akan dinolkan (kosong = tidak ada yang perlu ditutup). */
  accounts: ClosingNominalAccount[];
  revenueTotal: number;
  contraRevenueTotal: number;
  cogsTotal: number;
  expenseTotal: number;
  netIncome: number;
  /** Jurnal penutup yang akan diposting — pratinjau baris per baris. */
  lines: Array<{
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    description: string | null;
  }>;
  draftCount: number;
  /** Bulan lebih tua yang masih terbuka (label siap tampil). */
  earlierOpenPeriods: string[];
  /** Harus nol dulu sebelum tombol Tutup Buku boleh ditekan. */
  blockers: ClosingCheckItem[];
  /** Tidak menghalangi, tapi wajib dibaca. */
  warnings: ClosingCheckItem[];
  /** Terisi kalau periodenya sudah ditutup. */
  closingEntry: {
    id: string;
    entryNumber: string;
    entryDate: string;
  } | null;
};

export async function fetchPeriodClosePreview(
  periodId: string,
): Promise<ApiResult<PeriodClosePreview>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.period.view")) {
    return fail("FORBIDDEN", "Tidak punya akses periode akuntansi");
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

  const { firstDay, lastDay } = periodBounds(
    period.periodYear,
    period.periodMonth,
  );
  const periodLabel = periodLabelId(period.periodYear, period.periodMonth);

  const balances = await getAccountBalances({
    outletId: session.user.outletId,
    fromDate: firstDay,
    toDate: lastDay,
    /* Sama dengan closeAccountingPeriod: jurnal penutup/pembatalan dari
     * siklus tutup–buka sebelumnya tidak boleh ikut disapu lagi. */
    excludeClosingEntries: true,
  });

  const summary = summarizeClosingNominals(balances);
  const nominals = collectPeriodCloseBalances(balances);
  const nameByCode = new Map(balances.map((b) => [b.code, b.name]));

  let lines: PeriodClosePreview["lines"] = [];
  if (nominals.length > 0) {
    try {
      lines = mapPeriodClose({
        outletId: session.user.outletId,
        entryDate: lastDay,
        periodLabel: `${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}`,
        balances: nominals,
      }).map((l) => ({
        accountCode: l.accountCode ?? "",
        accountName: nameByCode.get(l.accountCode ?? "") ?? "",
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        description: l.description ?? null,
      }));
    } catch (e) {
      return fail(
        "VALIDATION",
        logAndSanitize(e, "accounting", "Gagal menyusun pratinjau jurnal penutup"),
      );
    }
  }

  const [draftRow] = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.periodId, periodId),
        eq(journalEntries.status, "draft"),
      ),
    );
  const draftCount = Number(draftRow?.c ?? 0);

  /* Bulan lebih tua yang masih terbuka. Menutup bulan Agustus sementara Juli
   * masih terbuka bukan kesalahan fatal (angkanya tetap per-bulan), tapi laba
   * ditahan jadi terisi tidak berurutan dan mudah membingungkan — jadi
   * ditampilkan sebagai peringatan. */
  const olderOpen = await db
    .select({
      year: accountingPeriods.periodYear,
      month: accountingPeriods.periodMonth,
    })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.outletId, session.user.outletId),
        eq(accountingPeriods.status, "open"),
        sql`(${accountingPeriods.periodYear} * 100 + ${accountingPeriods.periodMonth}) < ${period.periodYear * 100 + period.periodMonth}`,
      ),
    )
    .orderBy(asc(accountingPeriods.periodYear), asc(accountingPeriods.periodMonth));
  const earlierOpenPeriods = olderOpen.map((p) => periodLabelId(p.year, p.month));

  let closingEntry: PeriodClosePreview["closingEntry"] = null;
  if (period.closingEntryId) {
    const [row] = await db
      .select({
        id: journalEntries.id,
        entryNumber: journalEntries.entryNumber,
        entryDate: journalEntries.entryDate,
      })
      .from(journalEntries)
      .where(eq(journalEntries.id, period.closingEntryId))
      .limit(1);
    if (row) {
      closingEntry = {
        id: row.id,
        entryNumber: row.entryNumber,
        entryDate: String(row.entryDate),
      };
    }
  }

  const blockers: ClosingCheckItem[] = [];
  const warnings: ClosingCheckItem[] = [];

  if (period.status === "closed") {
    blockers.push({
      code: "ALREADY_CLOSED",
      message: `${periodLabel} sudah tutup buku. Buka kembali dulu kalau masih ada yang perlu dibetulkan.`,
    });
  } else if (period.status === "locked") {
    blockers.push({
      code: "LOCKED",
      message: `${periodLabel} sudah dikunci permanen — tidak bisa diubah lagi.`,
    });
  }
  if (draftCount > 0) {
    blockers.push({
      code: "HAS_DRAFTS",
      message: `${draftCount} jurnal masih berstatus draft. Posting atau hapus dulu — draft tidak ikut tersapu jurnal penutup.`,
    });
  }

  const check = periodBalanceCheck(balances);
  if (!check.balanced) {
    warnings.push({
      code: "UNBALANCED",
      message: `Buku bulan ini timpang: debit ${check.totalDebit} vs kredit ${check.totalCredit}. Periksa Laporan Validasi dulu — tutup buku akan mengunci angka yang keliru.`,
    });
  }
  if (earlierOpenPeriods.length > 0) {
    warnings.push({
      code: "EARLIER_OPEN",
      message: `Bulan lebih tua masih terbuka: ${earlierOpenPeriods.join(", ")}. Sebaiknya tutup berurutan dari yang paling lama.`,
    });
  }
  if (period.status === "open" && summary.accounts.length === 0) {
    warnings.push({
      code: "NOTHING_TO_CLOSE",
      message: `Tidak ada saldo pendapatan / HPP / beban di ${periodLabel}. Periode akan ditandai tutup tanpa jurnal penutup.`,
    });
  }

  return ok({
    periodId: period.id,
    periodYear: period.periodYear,
    periodMonth: period.periodMonth,
    periodLabel,
    status: period.status,
    firstDay,
    lastDay,
    accounts: summary.accounts,
    revenueTotal: summary.revenueTotal,
    contraRevenueTotal: summary.contraRevenueTotal,
    cogsTotal: summary.cogsTotal,
    expenseTotal: summary.expenseTotal,
    netIncome: summary.netIncome,
    lines,
    draftCount,
    earlierOpenPeriods,
    blockers,
    warnings,
    closingEntry,
  });
}

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

  /* Batas periode (hari terakhir bulan = entry_date jurnal penutup).
   * Sesi AE-211 — perhitungannya pindah ke `periodBounds` supaya layar
   * pratinjau Tutup Buku memakai batas yang persis sama. Catatan UTC dari
   * audit AE-186 ikut pindah ke sana. */
  const { firstDay, lastDay } = periodBounds(
    period.periodYear,
    period.periodMonth,
  );

  // Aggregate balances dalam period only (entry.entryDate dalam window).
  const balances = await getAccountBalances({
    outletId: session.user.outletId,
    fromDate: firstDay,
    toDate: lastDay,
    /* Defense-in-depth: closing/reopen entry lama (mis. dari siklus close →
     * reopen → close ulang) tak boleh ikut kehitung dalam sapuan baru. */
    excludeClosingEntries: true,
  });

  /* Sesi AE-211 — penyaringan akun nominal dipindah ke `collectPeriodCloseBalances`
   * dan dipakai bersama layar pratinjau Tutup Buku. Satu fungsi = angka yang
   * dilihat owner sebelum menekan tombol tidak mungkin beda dengan yang
   * diposting. */
  const periodCloseBalances: PeriodCloseAccountBalance[] =
    collectPeriodCloseBalances(balances);

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
        description: `Dibatalkan: ${l.description ?? ""}`,
      }));
      try {
        const reverseResult = await recordJournal({
          outletId: session.user.outletId,
          entryDate: String(closingEntry.entryDate),
          description: `Pembatalan jurnal tutup buku ${closingEntry.entryNumber} — ${reason}`,
          sourceType: "period_reopen",
          sourceId: closingEntry.id,
          lines: counterLines,
          actorId: session.user.id,
        });

        /* Pair-void: mark counter as 'reversed' + link reversesEntryId.
         * Tanpa ini, counter status='posted' tetap masuk ledger sum
         * sementara original excluded → net = -original. Pair-void
         * exclude keduanya → net = 0 (lihat reverseJournalEntry).
         *
         * Audit AE-186 — kedua penandaan dalam SATU transaksi (pola sama
         * dengan reverseJournalEntry): kalau proses mati di antara dua
         * update, tidak ada sisi yang tertinggal 'posted' sendirian.
         * Retry aman: recordJournal di atas idempoten per
         * (period_reopen, closingEntry.id). */
        await db.transaction(async (tx) => {
          await tx
            .update(journalEntries)
            .set({
              status: "reversed",
              reversedByEntryId: reverseResult.entryId,
              reverseReason: reason,
              updatedAt: new Date(),
            })
            .where(eq(journalEntries.id, closingEntry.id));

          await tx
            .update(journalEntries)
            .set({
              status: "reversed",
              reversesEntryId: closingEntry.id,
              updatedAt: new Date(),
            })
            .where(eq(journalEntries.id, reverseResult.entryId));
        });
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
  /** Sesi AE-206 — link bukti transaksi di Drive (opsional). */
  receiptImageUrl?: string | null;
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
      receiptImageUrl: normalizeReceiptUrl(input.receiptImageUrl),
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

/* ============================================================
 * Sesi AE-211 — Jurnal Penyesuaian (adjusting entry)
 *
 * Tiga jalan koreksi, tiga arti berbeda — jangan ditukar:
 *
 *   Edit Jurnal   `updateDraftJournalEntry` — mengubah entry yang SAMA.
 *                 Hanya DRAFT manual. Begitu ter-post, angkanya sudah masuk
 *                 laporan; mengubahnya di tempat menghapus jejak.
 *   Reverse       `reverseJournalEntry` — entry lawan bernilai SAMA PERSIS,
 *                 lalu keduanya ditandai `reversed` sehingga saling
 *                 meniadakan. Untuk jurnal yang memang TIDAK BOLEH ADA.
 *   Penyesuaian   fungsi di bawah ini — entry BARU berisi SELISIH-nya saja.
 *                 Entry aslinya tetap `posted` dan tetap terhitung. Untuk
 *                 jurnal yang benar tapi nilainya kurang/lebih, dan untuk
 *                 penyesuaian akhir bulan (akrual, penyusutan, dibayar di
 *                 muka, nilai stok).
 * ============================================================ */

export type PostAdjustingJournalInput = {
  entryDate: string;
  description: string;
  /** Wajib, min 10 karakter — ikut ke metadata entry DAN audit log. */
  reason: string;
  adjustmentType: AdjustmentKind;
  /** Opsional: jurnal yang sedang disesuaikan. Null = penyesuaian berdiri
   * sendiri (mis. penyusutan bulanan) yang tidak menunjuk entry manapun. */
  adjustsEntryId?: string | null;
  lines: ManualJournalLineInput[];
  status: "draft" | "posted";
  receiptImageUrl?: string | null;
};

export async function postAdjustingJournal(
  input: PostAdjustingJournalInput,
): Promise<
  ApiResult<{
    entryId: string;
    entryNumber: string;
    status: string;
    adjustsEntryNumber: string | null;
  }>
> {
  const session = await requireSession();

  if (input.status === "draft") {
    if (!hasPermission(session.user.role, "accounting.journal.draft")) {
      return fail("FORBIDDEN", "Tidak punya hak menyimpan draft penyesuaian");
    }
  } else {
    if (!hasPermission(session.user.role, "accounting.journal.post")) {
      return fail(
        "FORBIDDEN",
        "Hanya Owner yang dapat mem-posting jurnal penyesuaian",
      );
    }
  }

  if (!isAdjustmentKind(input.adjustmentType)) {
    return fail("VALIDATION", "Jenis penyesuaian tidak dikenal");
  }
  /* Alasan itu inti pembeda penyesuaian dari jurnal manual biasa: jurnal ini
   * mengoreksi angka yang SUDAH masuk laporan, jadi harus selalu bisa
   * dijelaskan kenapa. Panjang minimumnya disamakan dengan reverse. */
  const reason = (input.reason ?? "").trim();
  if (reason.length < 10) {
    return fail("VALIDATION", "Alasan penyesuaian minimal 10 karakter");
  }
  if (!input.description || input.description.trim().length < 3) {
    return fail("VALIDATION", "Deskripsi minimal 3 karakter");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate ?? "")) {
    return fail("VALIDATION", "Tanggal harus format YYYY-MM-DD");
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

  /* Jurnal yang disesuaikan (kalau ada) harus benar-benar berlaku. */
  let target: JournalEntryWithLines | null = null;
  if (input.adjustsEntryId) {
    target = await getJournalEntryById(
      session.user.outletId,
      input.adjustsEntryId,
    );
    if (!target) {
      return fail("NOT_FOUND", "Jurnal yang mau disesuaikan tidak ditemukan");
    }
    if (target.status === "reversed") {
      return fail(
        "INVALID_STATE",
        `${target.entryNumber} sudah dibatalkan (reversed) — saldonya nol, tidak ada yang perlu disesuaikan.`,
      );
    }
    if (target.status === "draft") {
      return fail(
        "INVALID_STATE",
        `${target.entryNumber} masih draft — perbaiki langsung lewat Edit Draft, tidak perlu jurnal penyesuaian.`,
      );
    }
  }

  /* Audit AE-186 (pola yang sama dengan reverse) — periode TUJUAN penyesuaian
   * wajib masih terbuka. Kalau bulannya sudah tutup buku, jurnal penutupnya
   * sudah menyapu pendapatan/beban bulan itu ke laba ditahan; menambah entry
   * baru sesudahnya membuat sapuan itu basi tanpa ada yang menghitung ulang.
   * recordJournal sendiri hanya menolak periode 'locked', jadi penjagaan
   * 'closed' harus di sini. */
  const [adjYear, adjMonth] = input.entryDate.split("-").map(Number);
  const [targetPeriod] = await db
    .select({
      status: accountingPeriods.status,
    })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.outletId, session.user.outletId),
        eq(accountingPeriods.periodYear, adjYear),
        eq(accountingPeriods.periodMonth, adjMonth),
      ),
    )
    .limit(1);
  if (targetPeriod && targetPeriod.status !== "open") {
    return fail(
      "PERIOD_LOCKED",
      `Periode ${periodLabelId(adjYear, adjMonth)} sudah ${targetPeriod.status === "closed" ? "tutup buku" : "dikunci"} — buka kembali dulu di Akuntansi → Tutup Buku, atau pakai tanggal di bulan yang masih terbuka.`,
    );
  }

  let result;
  try {
    result = await recordJournal({
      outletId: session.user.outletId,
      entryDate: input.entryDate,
      description: input.description.trim(),
      sourceType: "adjusting",
      /* sourceId NULL disengaja — satu jurnal boleh disesuaikan berkali-kali,
       * sedangkan ux_je_outlet_source_active hanya mengizinkan satu entry
       * aktif per (sourceType, sourceId). Tautannya lewat metadata. */
      sourceId: null,
      lines: input.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        description: l.description ?? null,
      })),
      status: input.status,
      receiptImageUrl: normalizeReceiptUrl(input.receiptImageUrl),
      metadata: {
        adjusting: {
          kind: input.adjustmentType,
          reason,
          adjustsEntryId: target?.id ?? null,
          adjustsEntryNumber: target?.entryNumber ?? null,
          adjustsEntryDate: target ? String(target.entryDate) : null,
        },
      },
      actorId: session.user.id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.startsWith("PERIOD_LOCKED")) {
      return fail(
        "PERIOD_LOCKED",
        `Periode ${periodLabelId(adjYear, adjMonth)} sudah dikunci permanen — pilih tanggal di bulan yang masih terbuka.`,
      );
    }
    if (msg.startsWith("JOURNAL_IMBALANCED")) {
      return fail("VALIDATION", "Debit tidak balance dengan credit");
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "accounting", "Operasi database gagal"),
    );
  }

  await logAudit({
    eventType:
      input.status === "draft"
        ? "journal_entry.adjust_draft"
        : "journal_entry.adjust",
    userId: session.user.id,
    entityType: "journal_entry",
    entityId: result.entryId,
    payload: {
      summary: `Jurnal penyesuaian ${result.entryNumber} (${adjustmentKindLabel(input.adjustmentType)})${target ? ` atas ${target.entryNumber}` : ""} — ${input.description.trim()}`,
      context: {
        reason,
        adjustmentType: input.adjustmentType,
        adjustsEntryId: target?.id ?? null,
        adjustsEntryNumber: target?.entryNumber ?? null,
      },
    },
  });

  return ok({
    entryId: result.entryId,
    entryNumber: result.entryNumber,
    status: input.status,
    adjustsEntryNumber: target?.entryNumber ?? null,
  });
}

/**
 * Sesi AE-211 — berapa jurnal penyesuaian yang menempel pada tiap entry di
 * halaman Jurnal. Dipakai untuk menandai entry asli dengan "Disesuaikan (n)"
 * supaya owner tidak menyesuaikan hal yang sama dua kali.
 *
 * Tautannya di `metadata.adjusting.adjustsEntryId` (bukan kolom) karena satu
 * entry boleh punya banyak penyesuaian — lihat catatan sourceId di atas.
 */
export async function fetchAdjustmentCounts(
  entryIds: string[],
): Promise<ApiResult<Record<string, number>>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.journal.view")) {
    return fail("FORBIDDEN", "Tidak punya akses jurnal");
  }
  if (entryIds.length === 0) return ok({});

  const rows = await db
    .select({
      targetId: sql<string>`${journalEntries.metadata}->'adjusting'->>'adjustsEntryId'`,
      total: sql<number>`COUNT(*)::int`,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, session.user.outletId),
        eq(journalEntries.sourceType, "adjusting"),
        sql`${journalEntries.status} <> 'reversed'`,
        /* Sesi AE-76 (aturan repo) — JANGAN pakai sql`= ANY(${array})`:
         * di Neon array-nya ter-interpolasi jadi banyak bind param dan
         * Postgres menolaknya. Pakai helper inArray, yang juga menerima
         * ekspresi SQL sebagai sisi kiri. */
        inArray(
          sql`${journalEntries.metadata}->'adjusting'->>'adjustsEntryId'`,
          entryIds,
        ),
      ),
    )
    .groupBy(sql`${journalEntries.metadata}->'adjusting'->>'adjustsEntryId'`);

  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.targetId) out[r.targetId] = Number(r.total);
  }
  return ok(out);
}

export async function reverseJournalEntry(
  entryId: string,
  reason: string,
): Promise<
  ApiResult<{
    id: string;
    reverseEntryId: string;
    reverseEntryNumber: string;
  }>
> {
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

  /* Sesi AE-185 — TOLAK kalau periodenya sudah dikunci. Periode terkunci
   * artinya laporannya sudah difinalkan; reverse akan mengeluarkan entry ini
   * dari total periode tersebut secara diam-diam. Sebelumnya tidak ada
   * penjagaan ini sama sekali. */
  const [origPeriod] = await db
    .select({
      status: accountingPeriods.status,
      year: accountingPeriods.periodYear,
      month: accountingPeriods.periodMonth,
    })
    .from(accountingPeriods)
    .where(eq(accountingPeriods.id, original.periodId))
    .limit(1);
  if (origPeriod?.status === "locked") {
    return fail(
      "PERIOD_LOCKED",
      `Periode ${origPeriod.year}-${String(origPeriod.month).padStart(2, "0")} sudah dikunci — buka kuncinya dulu di Akuntansi → Periode sebelum reverse.`,
    );
  }
  /* Audit AE-186 — periode 'closed' juga ditolak. Closing entry-nya sudah
   * menyapu revenue/beban bulan itu ke laba ditahan; reverse diam-diam bikin
   * closing entry basi (sapuannya tak dihitung ulang). Reopen dulu. */
  if (origPeriod?.status === "closed") {
    return fail(
      "PERIOD_LOCKED",
      `Periode ${origPeriod.year}-${String(origPeriod.month).padStart(2, "0")} sudah tutup buku — buka kembali (reopen) dulu di Akuntansi → Periode sebelum reverse.`,
    );
  }

  const counterLines = original.lines.map((l) => ({
    accountId: l.accountId,
    debit: Number(l.credit),
    credit: Number(l.debit),
    description: `Dibatalkan: ${l.description ?? ""}`,
  }));

  /* Audit AE-186 — reverse harus IDEMPOTEN. Counter dibuat dengan
   * sourceId null (tidak boleh pakai sourceId asli — masih dipegang entry
   * aslinya di unique index ux_je_outlet_source_active), jadi recordJournal
   * tidak bisa mendedup. Kalau run sebelumnya sempat membuat counter lalu
   * mati sebelum penandaan (kasus AE-182), retry TANPA lookup ini akan
   * melahirkan counter kedua — yang pertama tinggal 'posted' selamanya dan
   * buku besar minus sebesar entry aslinya. Maka: pakai lagi counter lama
   * kalau ada. */
  let reverseResult: { entryId: string; entryNumber: string };
  try {
    const [existingCounter] = await db
      .select({
        id: journalEntries.id,
        entryNumber: journalEntries.entryNumber,
      })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.outletId, session.user.outletId),
          sql`(${journalEntries.reversesEntryId} = ${original.id} OR ${journalEntries.metadata}->>'reversesEntryId' = ${original.id})`,
          sql`${journalEntries.status} <> 'reversed'`,
        ),
      )
      .limit(1);

    if (existingCounter) {
      reverseResult = {
        entryId: existingCounter.id,
        entryNumber: existingCounter.entryNumber,
      };
    } else {
      reverseResult = await recordJournal({
        outletId: session.user.outletId,
        /* Sesi AE-185 — entry lawan mengikuti tanggal ASLI, bukan hari ini.
         * Dulu pakai hari ini: reverse jurnal Mei menaruh lawannya di bulan
         * berjalan, jadi jumlah entry dua periode ikut bergeser dan jejaknya
         * susah dibaca. Karena keduanya ditandai 'reversed' (pair-void), saldo
         * tetap nol di mana pun ditaruh — jadi menaruhnya sekandang dengan yang
         * dibalik jelas lebih rapi. */
        entryDate: String(original.entryDate),
        description: `Pembatalan jurnal ${original.entryNumber} — ${reason}`,
        sourceType: original.sourceType,
        /* sourceId asli masih dipegang entry aslinya (unique active index) —
         * identitas counter disimpan di metadata.reversesEntryId dan dipakai
         * lookup idempoten di atas. */
        sourceId: null,
        lines: counterLines,
        actorId: session.user.id,
        metadata: { reversesEntryId: original.id, reason },
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.startsWith("PERIOD_LOCKED")) {
      return fail(
        "PERIOD_LOCKED",
        `Periode ${msg.split(":")[1] ?? ""} sudah dikunci — buka kuncinya dulu di Akuntansi → Periode.`,
      );
    }
    return fail("DB_ERROR", logAndSanitize(e, "accounting", "Operasi database gagal"));
  }

  /* Sesi AE-185 — kedua penandaan dalam SATU transaksi. Dulu dua update
   * terpisah: kalau yang pertama sukses lalu prosesnya mati (persis kasus
   * instance serverless dibekukan di sesi AE-182), hasilnya original
   * 'reversed' tapi lawannya masih 'posted' → buku besar jadi minus sebesar
   * entry aslinya. Satu transaksi menutup celah itu.
   *
   * Pair-void: KEDUA sisi ditandai 'reversed' supaya sama-sama keluar dari
   * perhitungan saldo (net nol). Kalau cuma satu, netnya jadi -original.
   *
   * Audit AE-186 — penandaan original pakai CAS (WHERE status='posted').
   * Dua reverse berbarengan (dua tab): yang kalah tidak menimpa penandaan
   * pemenang; counter-nya sendiri tetap di-void supaya tidak jadi entry
   * 'posted' yatim. */
  try {
    const marked = await db.transaction(async (tx) => {
      const updated = await tx
        .update(journalEntries)
        .set({
          status: "reversed",
          reversedByEntryId: reverseResult.entryId,
          reverseReason: reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(journalEntries.id, entryId),
            eq(journalEntries.status, "posted"),
          ),
        )
        .returning({ id: journalEntries.id });

      await tx
        .update(journalEntries)
        .set({
          reversesEntryId: entryId,
          status: "reversed",
          updatedAt: new Date(),
        })
        .where(eq(journalEntries.id, reverseResult.entryId));

      return updated.length > 0;
    });
    if (!marked) {
      return fail(
        "INVALID_STATE",
        "Entry sudah di-reverse oleh proses lain — tidak ada yang perlu diulang.",
      );
    }
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(
        e,
        "accounting",
        `Entry lawan ${reverseResult.entryNumber} sudah dibuat tapi penandaan gagal — jalankan reverse ulang (aman, counter lama dipakai lagi).`,
      ),
    );
  }

  await logAudit({
    eventType: "journal_entry.reverse",
    userId: session.user.id,
    entityType: "journal_entry",
    entityId: entryId,
    payload: {
      summary: `Reverse ${original.entryNumber} → ${reverseResult.entryNumber} — ${reason}`,
      context: {
        reverseEntryId: reverseResult.entryId,
        reverseEntryNumber: reverseResult.entryNumber,
        entryDate: String(original.entryDate),
        reason,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  return ok({
    id: entryId,
    reverseEntryId: reverseResult.entryId,
    reverseEntryNumber: reverseResult.entryNumber,
  });
}

/**
 * Sesi AE-185 — UBAH TANGGAL jurnal yang sudah posted, tanpa harus reverse.
 *
 * Permintaan owner: salah ketik tanggal itu kesalahan sepele, tapi selama ini
 * satu-satunya jalan adalah reverse lalu input ulang — meninggalkan dua entry
 * sampah dan nomor jurnal terbuang. Sekarang tanggalnya bisa dikoreksi
 * langsung, dengan jejak audit yang utuh.
 *
 * Yang dijaga:
 *  - Periode ASAL maupun TUJUAN tidak boleh terkunci. Periode terkunci artinya
 *    laporannya sudah difinalkan; memindahkan entry keluar/masuk diam-diam
 *    akan mengubah laporan yang sudah dikunci.
 *  - Entry berstatus 'reversed' tidak bisa diubah (sudah jadi arsip).
 *  - Kalau pindah BULAN, nomor jurnal diterbitkan ulang mengikuti periode baru
 *    (formatnya JE-YYYYMM-NNNN — kalau tidak, nomornya berbohong soal periode).
 *    Nomor & tanggal lama disimpan di metadata + audit log.
 *  - Seluruhnya dalam satu transaksi + advisory lock yang sama dengan
 *    recordJournal, supaya nomor tidak tabrakan dengan entry yang dibuat
 *    bersamaan.
 *
 * Saldo akun TIDAK berubah — hanya periode/tanggalnya. Yang bergeser adalah
 * laporan bulanan (Laba Rugi bulan asal & tujuan).
 */
export async function updateJournalEntryDate(input: {
  entryId: string;
  newDate: string;
  reason: string;
}): Promise<
  ApiResult<{
    id: string;
    entryNumber: string;
    previousEntryNumber: string;
    previousDate: string;
    renumbered: boolean;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.journal.post")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat mengubah tanggal jurnal");
  }
  const newDate = input.newDate?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    return fail("VALIDATION", "Tanggal harus format YYYY-MM-DD");
  }
  /* Audit AE-186 — regex lolos tanggal mustahil (2026-02-31, bulan 13) yang
   * baru meledak jadi DB_ERROR buram di constraint. Validasi kalender beneran:
   * parse UTC lalu cek round-trip. */
  {
    const [y, m, d] = newDate.split("-").map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (
      parsed.getUTCFullYear() !== y ||
      parsed.getUTCMonth() !== m - 1 ||
      parsed.getUTCDate() !== d
    ) {
      return fail("VALIDATION", `Tanggal ${newDate} tidak ada di kalender.`);
    }
  }
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) {
    return fail("VALIDATION", "Alasan perubahan minimal 5 karakter");
  }

  const original = await getJournalEntryById(session.user.outletId, input.entryId);
  if (!original) return fail("NOT_FOUND", "Entry tidak ditemukan");
  if (original.status === "reversed") {
    return fail(
      "INVALID_STATE",
      "Entry sudah di-reverse — tanggalnya tidak bisa diubah lagi.",
    );
  }
  /* Audit AE-186 — entry struktural JANGAN dipindah tanggal. Closing entry
   * ditunjuk accountingPeriods.closingEntryId dan menyapu P&L bulan itu —
   * memindahkannya bikin laporan pasca-close muncul lagi di bulan asal dan
   * sapuan raksasa mendarat di bulan tujuan. Saldo awal & rekonsiliasi COGS
   * juga terikat periode. (Pola sama dengan guard delete/edit draft yang
   * membatasi sourceType.) */
  const STRUCTURAL_SOURCE_TYPES = [
    "period_close",
    "period_reopen",
    "opening_balance",
    "cogs_period_close",
  ] as const;
  if (
    (STRUCTURAL_SOURCE_TYPES as readonly string[]).includes(
      original.sourceType,
    )
  ) {
    return fail(
      "INVALID_STATE",
      "Entry sistem (closing/saldo awal/rekonsiliasi COGS) tidak bisa diubah tanggalnya — kelola lewat menu Periode.",
    );
  }
  const previousDate = String(original.entryDate);
  if (previousDate === newDate) {
    return fail("NO_CHANGE", "Tanggal barunya sama dengan yang sekarang.");
  }

  const [oldY, oldM] = previousDate.split("-").map(Number);
  const [newY, newM] = newDate.split("-").map(Number);
  const periodChanged = isDifferentPeriod(previousDate, newDate);

  try {
    const result = await db.transaction(async (tx) => {
      /* Periode ASAL — tidak boleh terkunci ATAU sudah tutup buku (closing
       * entry-nya jadi basi kalau isinya berpindah). FOR UPDATE supaya status
       * tidak berubah di antara cek dan commit (TOCTOU vs lock/close). */
      const [oldPeriod] = await tx
        .select({ status: accountingPeriods.status })
        .from(accountingPeriods)
        .where(eq(accountingPeriods.id, original.periodId))
        .limit(1)
        .for("update");
      if (oldPeriod && oldPeriod.status !== "open") {
        throw new Error(`LOCKED_SOURCE:${oldY}-${String(oldM).padStart(2, "0")}`);
      }

      /* Periode TUJUAN — cari, buat kalau belum ada, tolak kalau terkunci. */
      let [targetPeriod] = await tx
        .select({
          id: accountingPeriods.id,
          status: accountingPeriods.status,
        })
        .from(accountingPeriods)
        .where(
          and(
            eq(accountingPeriods.outletId, session.user.outletId),
            eq(accountingPeriods.periodYear, newY),
            eq(accountingPeriods.periodMonth, newM),
          ),
        )
        .limit(1)
        .for("update");
      if (!targetPeriod) {
        [targetPeriod] = await tx
          .insert(accountingPeriods)
          .values({
            outletId: session.user.outletId,
            periodYear: newY,
            periodMonth: newM,
            status: "open",
          })
          .returning({
            id: accountingPeriods.id,
            status: accountingPeriods.status,
          });
      }
      /* Tujuan juga harus 'open' — pindah masuk ke bulan yang sudah tutup
       * buku sama bahayanya dengan keluar darinya. */
      if (targetPeriod.status !== "open") {
        throw new Error(`LOCKED_TARGET:${newY}-${String(newM).padStart(2, "0")}`);
      }

      let entryNumber = original.entryNumber;
      if (periodChanged) {
        /* Kunci urutan nomor untuk periode tujuan — pola sama persis dengan
         * recordJournal supaya tidak tabrakan dengan entry yang lahir
         * bersamaan. */
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${journalSeqLockKey(session.user.outletId, newY, newM)}))`,
        );
        const [{ maxSeq }] = await tx
          .select({
            maxSeq: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${journalEntries.entryNumber} FROM '-([0-9]+)$') AS INT)), 0)::int`,
          })
          .from(journalEntries)
          .where(eq(journalEntries.periodId, targetPeriod.id));
        entryNumber = formatJournalEntryNumber(newY, newM, maxSeq + 1);
      }

      const metadata = {
        ...((original.metadata as Record<string, unknown> | null) ?? {}),
        dateChangedFrom: previousDate,
        dateChangedAt: new Date().toISOString(),
        dateChangeReason: reason,
        ...(periodChanged
          ? { previousEntryNumber: original.entryNumber }
          : {}),
      };

      await tx
        .update(journalEntries)
        .set({
          entryDate: newDate,
          periodId: targetPeriod.id,
          entryNumber,
          metadata,
          updatedAt: new Date(),
        })
        .where(eq(journalEntries.id, input.entryId));

      return { entryNumber };
    });

    await logAudit({
      eventType: "journal_entry.date_changed",
      userId: session.user.id,
      entityType: "journal_entry",
      entityId: input.entryId,
      payload: {
        summary: `Tanggal ${original.entryNumber} diubah ${previousDate} → ${newDate}${
          periodChanged ? ` (nomor jadi ${result.entryNumber})` : ""
        } — ${reason}`,
        context: {
          previousDate,
          newDate,
          previousEntryNumber: original.entryNumber,
          entryNumber: result.entryNumber,
          periodChanged,
          reason,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    return ok({
      id: input.entryId,
      entryNumber: result.entryNumber,
      previousEntryNumber: original.entryNumber,
      previousDate,
      renumbered: periodChanged,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.startsWith("LOCKED_SOURCE:")) {
      return fail(
        "PERIOD_LOCKED",
        `Periode asal ${msg.split(":")[1]} sudah tutup buku / terkunci — buka dulu di Akuntansi → Periode.`,
      );
    }
    if (msg.startsWith("LOCKED_TARGET:")) {
      return fail(
        "PERIOD_LOCKED",
        `Periode tujuan ${msg.split(":")[1]} sudah tutup buku / terkunci — pilih tanggal lain atau buka dulu.`,
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "accounting", "Gagal mengubah tanggal jurnal"),
    );
  }
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
  /** Sesi AE-206 — bukti transaksi. `null` = hapus lampiran dari entry.
   * Field-nya selalu dikirim modal, jadi undefined pun diperlakukan hapus. */
  receiptImageUrl?: string | null;
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate ?? "")) {
    return fail("VALIDATION", "Tanggal harus format YYYY-MM-DD");
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
  /* Audit AE-186 — kalau tanggal baru pindah BULAN, periode + nomor jurnal
   * WAJIB ikut pindah (pola sama persis dengan updateJournalEntryDate).
   * Sebelumnya: draft Juli di-edit ke Agustus → tetap periodId Juli + nomor
   * JE-202607-xxxx → guard kunci-periode mengecek bulan yang salah dan
   * nomornya berbohong soal periode. */
  const draftPeriodChanged = isDifferentPeriod(
    String(original.entryDate),
    input.entryDate,
  );
  const [draftNewY, draftNewM] = input.entryDate.split("-").map(Number);

  try {
    await db.transaction(async (tx) => {
      let newPeriodFields: {
        periodId?: string;
        entryNumber?: string;
      } = {};
      if (draftPeriodChanged) {
        let [targetPeriod] = await tx
          .select({
            id: accountingPeriods.id,
            status: accountingPeriods.status,
          })
          .from(accountingPeriods)
          .where(
            and(
              eq(accountingPeriods.outletId, session.user.outletId),
              eq(accountingPeriods.periodYear, draftNewY),
              eq(accountingPeriods.periodMonth, draftNewM),
            ),
          )
          .limit(1)
          .for("update");
        if (!targetPeriod) {
          [targetPeriod] = await tx
            .insert(accountingPeriods)
            .values({
              outletId: session.user.outletId,
              periodYear: draftNewY,
              periodMonth: draftNewM,
              status: "open",
            })
            .returning({
              id: accountingPeriods.id,
              status: accountingPeriods.status,
            });
        }
        if (targetPeriod.status !== "open") {
          throw new Error(
            `LOCKED_TARGET:${draftNewY}-${String(draftNewM).padStart(2, "0")}`,
          );
        }
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${journalSeqLockKey(session.user.outletId, draftNewY, draftNewM)}))`,
        );
        const [{ maxSeq }] = await tx
          .select({
            maxSeq: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${journalEntries.entryNumber} FROM '-([0-9]+)$') AS INT)), 0)::int`,
          })
          .from(journalEntries)
          .where(eq(journalEntries.periodId, targetPeriod.id));
        newPeriodFields = {
          periodId: targetPeriod.id,
          entryNumber: formatJournalEntryNumber(draftNewY, draftNewM, maxSeq + 1),
        };
      }

      await tx
        .update(journalEntries)
        .set({
          entryDate: input.entryDate,
          ...newPeriodFields,
          description: input.description.trim(),
          status: targetStatus,
          postedAt: targetStatus === "posted" ? new Date() : null,
          postedBy: targetStatus === "posted" ? session.user.id : null,
          receiptImageUrl: normalizeReceiptUrl(input.receiptImageUrl),
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
    const msg = e instanceof Error ? e.message : "";
    if (msg.startsWith("LOCKED_TARGET:")) {
      return fail(
        "PERIOD_LOCKED",
        `Periode tujuan ${msg.split(":")[1]} sudah tutup buku / terkunci — pilih tanggal lain atau buka dulu.`,
      );
    }
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
    /* Ber-jendela = laporan mutasi periode → closing entry dikecualikan.
     * Kumulatif (fromDate null) = pasca-close view → ikutkan (match Neraca). */
    excludeClosingEntries: args.fromDate != null,
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
    /* Laba Rugi bulan yang sudah di-close: tanpa ini, closing entry ikut
     * kehitung dan seluruh revenue/beban jadi ~0. */
    excludeClosingEntries: true,
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

  /* 4. Sesi AE-209b — sisa kasbon karyawan yang belum lunas DAN ber-jurnal
   *    (kasbon lama di luar pembukuan tidak pernah menyentuh 1155, jadi
   *    jangan ikut dibandingkan — kalau ikut, laporan validasi bakal
   *    selalu merah padahal pembukuannya benar). */
  const [kasbonRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${employeeAdvances.amount} - ${employeeAdvances.repaidAmount}), 0)`,
    })
    .from(employeeAdvances)
    .where(
      and(
        eq(employeeAdvances.outletId, session.user.outletId),
        eq(employeeAdvances.status, "pending"),
        isNotNull(employeeAdvances.journalEntryId),
      ),
    );
  const sourceKasbon = Math.round(Number(kasbonRow?.total ?? 0));

  return ok(
    buildValidationReport({
      asOfDate,
      ledger: {
        kasTunai: ledgerKas,
        persediaanKitchen: ledgerPersediaanKitchen,
        persediaanBar: ledgerPersediaanBar,
        persediaanPendukung: ledgerPersediaanPendukung,
        hutangDagang: ledgerHutang,
        piutangKasbon: balanceOf("1155"),
      },
      source: {
        cashOnHand: sourceCashOnHandStrict,
        persediaanKitchen: sourceKitchen,
        persediaanBar: sourceBar,
        persediaanPendukung: sourcePendukung,
        hutangDagangPending: sourceHutang,
        kasbonOutstanding: sourceKasbon,
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
