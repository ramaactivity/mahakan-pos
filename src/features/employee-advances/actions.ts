"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  employeeAdvanceRepayments,
  employeeAdvances,
  employees,
  payrollPeriods,
  users,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { lockEmployeeAdvance } from "@/lib/db/locking";
import { normalizeReceiptUrl } from "@/features/accounting/receipt-url";
import { recordJournal } from "@/features/accounting/posting";
import {
  mapEmployeeAdvanceForgive,
  mapEmployeeAdvanceIssue,
  mapEmployeeAdvanceRepayment as mapAdvanceRepaymentLines,
  mapEmployeeAdvanceRepaymentReversal,
} from "@/features/accounting/mapping/employeeAdvance";
import { resolveBankCodeFromBankName } from "@/features/accounting/mapping/dividendWithdrawal";
import { startOfWibDateUtc, todayWibIso } from "@/features/cash/helpers";
import {
  createEmployeeAdvanceSchema,
  forgiveEmployeeAdvanceSchema,
  postEmployeeAdvanceRepaymentSchema,
  reverseEmployeeAdvanceRepaymentSchema,
} from "@/features/payroll/schemas";
import {
  fail,
  ok,
  type ApiResult,
  type CreateEmployeeAdvanceInput,
  type EmployeeAdvance,
  type EmployeeAdvanceRepaymentListRow,
  type EmployeeAdvanceWithEmployee,
  type ListEmployeeAdvanceRepaymentsOptions,
  type ListEmployeeAdvancesOptions,
  type PostEmployeeAdvanceRepaymentInput,
  type ReverseEmployeeAdvanceRepaymentInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/** Akun kas tunai (drawer). Lawan jurnal kasbon tunai & setoran tunai. */
const ACCOUNT_KAS = "1101";

function bankLabelOf(
  bankName: string | null,
  accountName: string | null,
  accountNumber: string | null,
): string | null {
  if (!bankName && !accountName && !accountNumber) return null;
  const numTail =
    accountNumber && accountNumber.length > 4
      ? `...${accountNumber.slice(-4)}`
      : (accountNumber ?? "");
  return [bankName, accountName, numTail].filter(Boolean).join(" — ");
}

/**
 * Sesi AE-209b — resolve rekening bisnis milik outlet ini + kode COA-nya.
 * Dipakai jalur kasbon dari bank dan cicilan lewat transfer.
 */
async function resolveOutletBank(
  outletId: string,
  bankAccountId: string,
): Promise<
  | { ok: true; accountCode: string; label: string }
  | { ok: false; error: ApiResult<never> }
> {
  const [bank] = await db
    .select({
      outletId: bankAccounts.outletId,
      isActive: bankAccounts.isActive,
      bankName: bankAccounts.bankName,
      accountName: bankAccounts.accountName,
      accountNumber: bankAccounts.accountNumber,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, bankAccountId))
    .limit(1);
  if (!bank) {
    return { ok: false, error: fail("NOT_FOUND", "Rekening tidak ditemukan") };
  }
  if (bank.outletId !== outletId) {
    return { ok: false, error: fail("FORBIDDEN", "Rekening dari outlet lain") };
  }
  if (!bank.isActive) {
    return {
      ok: false,
      error: fail("INVALID_STATE", "Rekening sudah tidak aktif"),
    };
  }
  return {
    ok: true,
    accountCode: resolveBankCodeFromBankName(bank.bankName),
    label:
      bankLabelOf(bank.bankName, bank.accountName, bank.accountNumber) ??
      "rekening bisnis",
  };
}

/**
 * Pesan error yang bisa dibaca owner untuk kegagalan posting jurnal yang
 * sudah kita duga. Sisanya di-sanitize lewat logAndSanitize.
 */
function journalFailureMessage(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.startsWith("PERIOD_LOCKED")) {
    return `Periode akuntansi ${msg.split(":")[1] ?? ""} sudah ditutup — buka dulu periodenya atau pakai tanggal lain`;
  }
  if (msg.startsWith("ACCOUNT_NOT_FOUND")) {
    return `Akun ${msg.split(":")[1] ?? ""} belum ada di Bagan Akun — jalankan seed akun dulu`;
  }
  if (msg.startsWith("ACCOUNT_INACTIVE")) {
    return `Akun ${msg.split(":")[1] ?? ""} non-aktif di Bagan Akun`;
  }
  return null;
}

/* Sesi AE-60 — Buat kasbon baru. Status default 'pending'. Saat next
 * payroll compute, akan auto-link ke periode tersebut.
 *
 * Sesi AE-209b — kasbon sekarang MASUK PEMBUKUAN: uang yang keluar dijurnal
 * Dr 1155 Piutang Kasbon Karyawan / Cr Kas atau <bank> sesuai fundingSource,
 * sinkron di dalam transaction (pola modul kreditur/hutang internal, bukan
 * hook fire-and-forget) supaya kasbon tidak pernah tercatat tanpa jurnalnya.
 * Pengecualian: fundingSource='opening_balance' (kasbon lama yang uangnya
 * sudah keluar sebelum fitur ini) sengaja TANPA jurnal. */
export async function createEmployeeAdvance(
  input: CreateEmployeeAdvanceInput,
): Promise<ApiResult<EmployeeAdvance>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak buat kasbon");
  }
  const parsed = createEmployeeAdvanceSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  const v = parsed.data;

  // Validate employee belongs to outlet + active
  const [emp] = await db
    .select({ id: employees.id, fullName: employees.fullName, outletId: employees.outletId, status: employees.status })
    .from(employees)
    .where(eq(employees.id, v.employeeId))
    .limit(1);
  if (!emp) return fail("NOT_FOUND", "Karyawan tidak ditemukan");
  if (emp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Karyawan dari outlet lain");
  }
  if (emp.status !== "active") {
    return fail(
      "EMPLOYEE_INACTIVE",
      "Karyawan non-aktif tidak bisa di-kasih kasbon",
    );
  }

  /* Sesi AE-209b — resolve lawan jurnal sebelum buka transaction. */
  let sourceAccountCode = ACCOUNT_KAS;
  let sourceLabel = "Kas";
  if (v.fundingSource === "bank" && v.bankAccountId) {
    const res = await resolveOutletBank(
      session.user.outletId,
      v.bankAccountId,
    );
    if (!res.ok) return res.error;
    sourceAccountCode = res.accountCode;
    sourceLabel = res.label;
  }
  const withJournal = v.fundingSource !== "opening_balance";

  let created: EmployeeAdvance;
  try {
    created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(employeeAdvances)
        .values({
          outletId: session.user.outletId,
          employeeId: v.employeeId,
          amount: v.amount,
          reason: v.reason ?? null,
          issuedDate: v.issuedDate,
          fundingSource: v.fundingSource,
          bankAccountId:
            v.fundingSource === "bank" ? (v.bankAccountId ?? null) : null,
          status: "pending",
          createdBy: session.user.id,
        })
        .returning();

      if (!withJournal) return row;

      const journalResult = await recordJournal({
        outletId: session.user.outletId,
        entryDate: v.issuedDate,
        description: `Kasbon ${emp.fullName} — Rp ${v.amount.toLocaleString("id-ID")}`,
        sourceType: "employee_advance_issue",
        sourceId: row.id,
        lines: mapEmployeeAdvanceIssue({
          amount: v.amount,
          sourceAccountCode,
          sourceLabel,
          employeeName: emp.fullName,
        }),
        status: "posted",
        actorId: session.user.id,
        metadata: {
          advanceId: row.id,
          employeeId: v.employeeId,
          employeeName: emp.fullName,
          fundingSource: v.fundingSource,
        },
      });

      const [withJournalRow] = await tx
        .update(employeeAdvances)
        .set({ journalEntryId: journalResult.entryId })
        .where(eq(employeeAdvances.id, row.id))
        .returning();
      return withJournalRow;
    });
  } catch (e) {
    const friendly = journalFailureMessage(e);
    return fail(
      friendly ? "JOURNAL_FAILED" : "DB_ERROR",
      friendly ??
        logAndSanitize(e, "advance.create", "Operasi database gagal"),
    );
  }

  logAudit({
    eventType: "advance.create",
    userId: session.user.id,
    entityType: "employee_advance",
    entityId: created.id,
    payload: {
      summary: `Kasbon Rp ${v.amount.toLocaleString("id-ID")} untuk ${emp.fullName}`,
      after: {
        employeeId: v.employeeId,
        employeeName: emp.fullName,
        amount: v.amount,
        reason: v.reason,
        issuedDate: v.issuedDate,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit advance.create]", e));

  return ok(created);
}

/* Sesi AE-60 — Forgive (maafkan) kasbon. Status pending → forgiven.
 * Tidak akan dipotong dari payroll.
 *
 * Sesi AE-209b — kalau kasbonnya ber-jurnal (Dr 1155), sisa piutangnya
 * WAJIB dihapus lewat jurnal Dr 6102 Tunjangan & Bonus / Cr 1155: uangnya
 * jadi tunjangan buat karyawan, dan piutang yang tidak akan ditagih lagi
 * tidak boleh nyangkut di Neraca. Yang dihapus cuma SISA (nominal −
 * cicilan yang sudah masuk), karena bagian yang sudah dicicil sudah
 * meng-kredit 1155 duluan. */
export async function forgiveEmployeeAdvance(
  id: string,
): Promise<ApiResult<EmployeeAdvance>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak forgive kasbon");
  }
  const parsed = forgiveEmployeeAdvanceSchema.safeParse({ id });
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }

  const [current] = await db
    .select()
    .from(employeeAdvances)
    .where(eq(employeeAdvances.id, id))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Kasbon tidak ditemukan");
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Kasbon dari outlet lain");
  }
  if (current.status !== "pending") {
    return fail(
      "INVALID_STATE",
      "Hanya kasbon status 'pending' yang bisa di-forgive",
    );
  }

  const [emp] = await db
    .select({ fullName: employees.fullName })
    .from(employees)
    .where(eq(employees.id, current.employeeId))
    .limit(1);
  const employeeName = emp?.fullName ?? "karyawan";
  const remaining =
    Number(current.amount) - Number(current.repaidAmount ?? 0);

  let updated: EmployeeAdvance;
  try {
    updated = await db.transaction(async (tx) => {
      await lockEmployeeAdvance(tx, id);

      /* Re-check post-lock — cicilan bisa masuk barusan. */
      const [fresh] = await tx
        .select({
          status: employeeAdvances.status,
          amount: employeeAdvances.amount,
          repaidAmount: employeeAdvances.repaidAmount,
        })
        .from(employeeAdvances)
        .where(eq(employeeAdvances.id, id))
        .limit(1);
      if (!fresh) throw new Error("ADVANCE_NOT_FOUND");
      if (fresh.status !== "pending") throw new Error("ADVANCE_NOT_PENDING");
      const freshRemaining =
        Number(fresh.amount) - Number(fresh.repaidAmount ?? 0);

      /* Hapus sisa piutang HANYA kalau kasbonnya memang ada di pembukuan. */
      if (current.journalEntryId && freshRemaining > 0) {
        await recordJournal({
          outletId: session.user.outletId,
          entryDate: todayWibIso(),
          description: `Kasbon ${employeeName} dimaafkan — Rp ${freshRemaining.toLocaleString("id-ID")}`,
          sourceType: "employee_advance_forgive",
          sourceId: id,
          lines: mapEmployeeAdvanceForgive({
            amount: freshRemaining,
            employeeName,
          }),
          status: "posted",
          actorId: session.user.id,
          metadata: {
            advanceId: id,
            employeeName,
            forgivenAmount: freshRemaining,
          },
        });
      }

      const [row] = await tx
        .update(employeeAdvances)
        .set({
          status: "forgiven",
          resolvedAt: new Date(),
          resolvedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(employeeAdvances.id, id))
        .returning();
      return row;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "ADVANCE_NOT_PENDING") {
      return fail(
        "INVALID_STATE",
        "Status kasbon berubah barusan — muat ulang halaman",
      );
    }
    const friendly = journalFailureMessage(e);
    return fail(
      friendly ? "JOURNAL_FAILED" : "DB_ERROR",
      friendly ??
        logAndSanitize(e, "advance.forgive", "Operasi database gagal"),
    );
  }

  logAudit({
    eventType: "advance.forgive",
    userId: session.user.id,
    entityType: "employee_advance",
    entityId: id,
    payload: {
      summary: `Kasbon ${employeeName} Rp ${Number(current.amount).toLocaleString("id-ID")} di-forgive (sisa dihapus Rp ${remaining.toLocaleString("id-ID")})`,
      before: { status: current.status },
      after: {
        status: "forgiven",
        forgivenRemaining: remaining,
        journaled: Boolean(current.journalEntryId),
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit advance.forgive]", e));

  return ok(updated);
}

export async function listEmployeeAdvances(
  options: ListEmployeeAdvancesOptions = {},
): Promise<ApiResult<EmployeeAdvanceWithEmployee[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat kasbon");
  }
  const limit = options.limit ?? 100;
  const conds = [eq(employeeAdvances.outletId, session.user.outletId)];
  if (options.employeeId) {
    conds.push(eq(employeeAdvances.employeeId, options.employeeId));
  }
  if (options.status && options.status !== "all") {
    conds.push(eq(employeeAdvances.status, options.status));
  }

  const rows = await db
    .select({
      advance: employeeAdvances,
      employeeName: employees.fullName,
    })
    .from(employeeAdvances)
    .innerJoin(employees, eq(employees.id, employeeAdvances.employeeId))
    .where(and(...conds))
    .orderBy(desc(employeeAdvances.createdAt))
    .limit(limit);

  if (rows.length === 0) return ok([]);

  // Resolve creator + resolver names + period labels in batch
  const userIds = Array.from(
    new Set(
      rows.flatMap((r) =>
        [r.advance.createdBy, r.advance.resolvedBy].filter(
          (x): x is string => Boolean(x),
        ),
      ),
    ),
  );
  const userMap = new Map<string, string>();
  if (userIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const u of userRows) userMap.set(u.id, u.name);
  }

  const periodIds = Array.from(
    new Set(
      rows
        .map((r) => r.advance.deductedFromPeriodId)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  const periodMap = new Map<string, string>();
  if (periodIds.length > 0) {
    const periodRows = await db
      .select({ id: payrollPeriods.id, label: payrollPeriods.label })
      .from(payrollPeriods)
      .where(inArray(payrollPeriods.id, periodIds));
    for (const p of periodRows) periodMap.set(p.id, p.label);
  }

  /* Sesi AE-209 — jumlah cicilan posted per kasbon (buat kolom riwayat). */
  const repayCountMap = new Map<string, number>();
  const advanceIds = rows.map((r) => r.advance.id);
  if (advanceIds.length > 0) {
    const countRows = await db
      .select({
        advanceId: employeeAdvanceRepayments.advanceId,
        n: sql<number>`COUNT(*)::int`,
      })
      .from(employeeAdvanceRepayments)
      .where(
        and(
          inArray(employeeAdvanceRepayments.advanceId, advanceIds),
          eq(employeeAdvanceRepayments.status, "posted"),
        ),
      )
      .groupBy(employeeAdvanceRepayments.advanceId);
    for (const c of countRows) repayCountMap.set(c.advanceId, Number(c.n));
  }

  const result: EmployeeAdvanceWithEmployee[] = rows.map((r) => ({
    ...r.advance,
    employeeName: r.employeeName,
    createdByName: userMap.get(r.advance.createdBy) ?? null,
    resolvedByName: r.advance.resolvedBy
      ? (userMap.get(r.advance.resolvedBy) ?? null)
      : null,
    deductedFromPeriodLabel: r.advance.deductedFromPeriodId
      ? (periodMap.get(r.advance.deductedFromPeriodId) ?? null)
      : null,
    remainingAmount:
      Number(r.advance.amount) - Number(r.advance.repaidAmount ?? 0),
    repaymentCount: repayCountMap.get(r.advance.id) ?? 0,
  }));

  return ok(result);
}

// ============================================================================
// Sesi AE-209 — Cicilan kasbon
// ============================================================================

/**
 * Catat cicilan kasbon. Karyawan bayar balik di luar potong gaji — setor
 * tunai ke kasir atau transfer ke rekening bisnis (boleh dilampiri bukti
 * transfer).
 *
 * Yang dijaga di sini:
 *  - hanya kasbon status 'pending' yang bisa dicicil. 'deducted' sudah
 *    ditagih lewat gaji, 'forgiven'/'repaid' sudah selesai — nyicil lagi
 *    berarti nagih dua kali.
 *  - cicilan tidak boleh melebihi SISA (amount − repaidAmount), dicek ulang
 *    setelah row kasbon dikunci supaya dua klik bersamaan tidak lolos.
 *  - kalau sisa jadi 0 → status 'repaid' + resolvedAt (kasbon lunas, tidak
 *    lagi ikut ditarik payroll compute).
 *
 * Sesi AE-209b — kalau kasbonnya ber-jurnal (Dr 1155), cicilan diposting
 * Dr Kas/<bank> / Cr 1155 sinkron dalam transaction. Kasbon lama yang tidak
 * pernah masuk pembukuan (`journal_entry_id` NULL) tetap tanpa jurnal —
 * credit 1155 tanpa debit pasangannya bikin saldo piutang MINUS.
 */
export async function postEmployeeAdvanceRepayment(
  input: PostEmployeeAdvanceRepaymentInput,
): Promise<ApiResult<{ id: string; remainingAmount: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak catat cicilan kasbon");
  }
  const parsed = postEmployeeAdvanceRepaymentSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  const v = parsed.data;

  const [row] = await db
    .select({
      advance: employeeAdvances,
      employeeName: employees.fullName,
    })
    .from(employeeAdvances)
    .innerJoin(employees, eq(employees.id, employeeAdvances.employeeId))
    .where(eq(employeeAdvances.id, v.advanceId))
    .limit(1);
  if (!row) return fail("NOT_FOUND", "Kasbon tidak ditemukan");
  if (row.advance.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Kasbon dari outlet lain");
  }
  if (row.advance.status !== "pending") {
    return fail(
      "INVALID_STATE",
      row.advance.status === "deducted"
        ? "Kasbon ini sudah dipotong dari gaji — tidak bisa dicicil lagi"
        : row.advance.status === "repaid"
          ? "Kasbon ini sudah lunas"
          : "Kasbon ini sudah di-forgive",
    );
  }

  /* Akun tujuan uang masuk: kas tunai atau rekening yang dipilih. */
  let destinationAccountCode = ACCOUNT_KAS;
  let destinationLabel = "Kas";
  if (v.method === "transfer" && v.bankAccountId) {
    const res = await resolveOutletBank(
      session.user.outletId,
      v.bankAccountId,
    );
    if (!res.ok) return res.error;
    destinationAccountCode = res.accountCode;
    destinationLabel = res.label;
  }
  const bankLabel = v.method === "transfer" ? destinationLabel : null;
  /* Kasbon di luar pembukuan (baris lama / 'opening_balance') tetap tanpa
   * jurnal — lihat komentar di atas fungsi ini. */
  const withJournal = Boolean(row.advance.journalEntryId);

  const receiptImageUrl = normalizeReceiptUrl(v.receiptImageUrl);
  const occurredAt = startOfWibDateUtc(v.occurredAt);

  try {
    const result = await db.transaction(async (tx) => {
      await lockEmployeeAdvance(tx, v.advanceId);

      /* Re-read post-lock — sisa hutang bisa berubah barusan. */
      const [fresh] = await tx
        .select({
          amount: employeeAdvances.amount,
          repaidAmount: employeeAdvances.repaidAmount,
          status: employeeAdvances.status,
        })
        .from(employeeAdvances)
        .where(eq(employeeAdvances.id, v.advanceId))
        .limit(1);
      if (!fresh) throw new Error("ADVANCE_NOT_FOUND");
      if (fresh.status !== "pending") throw new Error("ADVANCE_NOT_PENDING");

      const remainingBefore =
        Number(fresh.amount) - Number(fresh.repaidAmount ?? 0);
      if (v.amount > remainingBefore) {
        throw new Error(`AMOUNT_OVER:${remainingBefore}`);
      }

      const [rp] = await tx
        .insert(employeeAdvanceRepayments)
        .values({
          outletId: session.user.outletId,
          advanceId: v.advanceId,
          employeeId: row.advance.employeeId,
          amount: v.amount,
          method: v.method,
          bankAccountId: v.method === "transfer" ? v.bankAccountId : null,
          occurredAt,
          description: v.description ?? null,
          receiptImageUrl,
          status: "posted",
          createdBy: session.user.id,
        })
        .returning({ id: employeeAdvanceRepayments.id });

      if (withJournal) {
        const journalResult = await recordJournal({
          outletId: session.user.outletId,
          entryDate: v.occurredAt,
          description: `Cicilan kasbon ${row.employeeName} — Rp ${v.amount.toLocaleString("id-ID")}`,
          sourceType: "employee_advance_repayment",
          sourceId: rp.id,
          lines: mapAdvanceRepaymentLines({
            amount: v.amount,
            destinationAccountCode,
            destinationLabel,
            employeeName: row.employeeName,
          }),
          status: "posted",
          actorId: session.user.id,
          /* Bukti transfer ikut nempel di jurnalnya (pola AE-206/AE-208). */
          receiptImageUrl,
          metadata: {
            repaymentId: rp.id,
            advanceId: v.advanceId,
            employeeName: row.employeeName,
            method: v.method,
          },
        });
        await tx
          .update(employeeAdvanceRepayments)
          .set({ journalEntryId: journalResult.entryId })
          .where(eq(employeeAdvanceRepayments.id, rp.id));
      }

      const remainingAfter = remainingBefore - v.amount;
      const lunas = remainingAfter === 0;
      await tx
        .update(employeeAdvances)
        .set({
          repaidAmount: Number(fresh.repaidAmount ?? 0) + v.amount,
          /* Lunas via cicilan → keluar dari daftar tarikan payroll. */
          ...(lunas
            ? {
                status: "repaid" as const,
                resolvedAt: new Date(),
                resolvedBy: session.user.id,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(employeeAdvances.id, v.advanceId));

      return { repaymentId: rp.id, remainingAfter };
    });

    logAudit({
      eventType: "advance.repayment.post",
      userId: session.user.id,
      entityType: "employee_advance_repayment",
      entityId: result.repaymentId,
      payload: {
        summary: `Cicilan kasbon ${row.employeeName} Rp ${v.amount.toLocaleString("id-ID")} (${v.method === "cash" ? "tunai" : (bankLabel ?? "transfer")})`,
        after: {
          advanceId: v.advanceId,
          amount: v.amount,
          method: v.method,
          remainingAmount: result.remainingAfter,
          receiptImageUrl,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit advance.repayment.post]", e));

    return ok({
      id: result.repaymentId,
      remainingAmount: result.remainingAfter,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("AMOUNT_OVER:")) {
      const sisa = Number(msg.split(":")[1] ?? 0);
      return fail(
        "INVALID_AMOUNT",
        `Cicilan melebihi sisa kasbon Rp ${sisa.toLocaleString("id-ID")}`,
      );
    }
    if (msg === "ADVANCE_NOT_PENDING") {
      return fail(
        "INVALID_STATE",
        "Status kasbon berubah barusan — muat ulang halaman",
      );
    }
    const friendly = journalFailureMessage(e);
    return fail(
      friendly ? "JOURNAL_FAILED" : "DB_ERROR",
      friendly ??
        logAndSanitize(
          e,
          "advance.repayment.post",
          "Operasi database gagal",
        ),
    );
  }
}

/**
 * Batalkan cicilan (salah input / uangnya ternyata tidak masuk). Sisa
 * kasbon kembali naik dan kasbon yang tadinya 'repaid' balik jadi
 * 'pending' supaya ikut ditarik payroll lagi.
 *
 * Baris cicilan TIDAK dihapus — statusnya jadi 'reversed' + alasannya
 * disimpan (audit trail, pola reversal modul kreditur/hutang internal).
 *
 * Sesi AE-209b — cicilan yang punya jurnal dapat jurnal PEMBALIK
 * (Dr 1155 / Cr kas atau bank) bertanggal hari ini, bukan hapus jurnal
 * lama: periode yang sudah ditutup tidak boleh diubah ke belakang.
 */
export async function reverseEmployeeAdvanceRepayment(
  input: ReverseEmployeeAdvanceRepaymentInput,
): Promise<ApiResult<{ id: string; remainingAmount: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak batalkan cicilan kasbon");
  }
  const parsed = reverseEmployeeAdvanceRepaymentSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  const v = parsed.data;

  const [rp] = await db
    .select()
    .from(employeeAdvanceRepayments)
    .where(eq(employeeAdvanceRepayments.id, v.id))
    .limit(1);
  if (!rp) return fail("NOT_FOUND", "Cicilan tidak ditemukan");
  if (rp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Cicilan dari outlet lain");
  }
  if (rp.status === "reversed") {
    /* Idempoten — sudah dibatalkan sebelumnya. */
    return ok({ id: rp.id, remainingAmount: -1 });
  }

  /* Resolve akun & nama untuk jurnal pembalik (kalau cicilannya dijurnal). */
  let destinationAccountCode = ACCOUNT_KAS;
  let destinationLabel = "Kas";
  if (rp.bankAccountId) {
    const [bank] = await db
      .select({
        bankName: bankAccounts.bankName,
        accountName: bankAccounts.accountName,
        accountNumber: bankAccounts.accountNumber,
      })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, rp.bankAccountId))
      .limit(1);
    if (bank) {
      destinationAccountCode = resolveBankCodeFromBankName(bank.bankName);
      destinationLabel =
        bankLabelOf(bank.bankName, bank.accountName, bank.accountNumber) ??
        "rekening bisnis";
    }
  }
  const [rpEmp] = await db
    .select({ fullName: employees.fullName })
    .from(employees)
    .where(eq(employees.id, rp.employeeId))
    .limit(1);
  const repaymentEmployeeName = rpEmp?.fullName ?? "karyawan";

  try {
    const result = await db.transaction(async (tx) => {
      await lockEmployeeAdvance(tx, rp.advanceId);

      const [fresh] = await tx
        .select({
          amount: employeeAdvances.amount,
          repaidAmount: employeeAdvances.repaidAmount,
          status: employeeAdvances.status,
        })
        .from(employeeAdvances)
        .where(eq(employeeAdvances.id, rp.advanceId))
        .limit(1);
      if (!fresh) throw new Error("ADVANCE_NOT_FOUND");
      /* Kasbon yang sudah dipotong gaji atau di-forgive tidak boleh
       * ditarik balik dari sini — angkanya sudah dipakai payroll. */
      if (fresh.status === "deducted" || fresh.status === "forgiven") {
        throw new Error(`ADVANCE_RESOLVED:${fresh.status}`);
      }

      const [updated] = await tx
        .update(employeeAdvanceRepayments)
        .set({
          status: "reversed",
          reversedAt: new Date(),
          reversedBy: session.user.id,
          reversalReason: v.reason,
        })
        .where(
          and(
            eq(employeeAdvanceRepayments.id, rp.id),
            eq(employeeAdvanceRepayments.status, "posted"),
          ),
        )
        .returning({ id: employeeAdvanceRepayments.id });
      /* CAS: kalau baris sudah di-reverse duluan oleh request lain,
       * jangan kurangi repaidAmount dua kali. */
      if (!updated) throw new Error("ALREADY_REVERSED");

      /* Jurnal pembalik hanya untuk cicilan yang memang dijurnal. */
      if (rp.journalEntryId) {
        await recordJournal({
          outletId: session.user.outletId,
          entryDate: todayWibIso(),
          description: `Batal cicilan kasbon ${repaymentEmployeeName} — Rp ${Number(rp.amount).toLocaleString("id-ID")}`,
          sourceType: "employee_advance_repayment_reversal",
          sourceId: rp.id,
          lines: mapEmployeeAdvanceRepaymentReversal({
            amount: Number(rp.amount),
            destinationAccountCode,
            destinationLabel,
            employeeName: repaymentEmployeeName,
            reason: v.reason,
          }),
          status: "posted",
          actorId: session.user.id,
          metadata: {
            repaymentId: rp.id,
            advanceId: rp.advanceId,
            reversalReason: v.reason,
            originalAmount: Number(rp.amount),
          },
        });
      }

      const newRepaid = Math.max(
        0,
        Number(fresh.repaidAmount ?? 0) - Number(rp.amount),
      );
      await tx
        .update(employeeAdvances)
        .set({
          repaidAmount: newRepaid,
          /* Balik jadi pending supaya sisanya ikut ditarik payroll lagi. */
          status: "pending",
          resolvedAt: null,
          resolvedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(employeeAdvances.id, rp.advanceId));

      return { remainingAmount: Number(fresh.amount) - newRepaid };
    });

    logAudit({
      eventType: "advance.repayment.reverse",
      userId: session.user.id,
      entityType: "employee_advance_repayment",
      entityId: rp.id,
      payload: {
        summary: `Cicilan kasbon Rp ${Number(rp.amount).toLocaleString("id-ID")} dibatalkan: ${v.reason}`,
        before: { status: "posted" },
        after: {
          status: "reversed",
          reversalReason: v.reason,
          remainingAmount: result.remainingAmount,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit advance.repayment.reverse]", e));

    return ok({ id: rp.id, remainingAmount: result.remainingAmount });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "ALREADY_REVERSED") {
      return ok({ id: rp.id, remainingAmount: -1 });
    }
    if (msg.startsWith("ADVANCE_RESOLVED:")) {
      return fail(
        "INVALID_STATE",
        msg.endsWith("deducted")
          ? "Kasbon sudah dipotong dari gaji — batalkan lewat recompute payroll, bukan dari sini"
          : "Kasbon sudah di-forgive — cicilannya tidak bisa dibatalkan",
      );
    }
    const friendly = journalFailureMessage(e);
    return fail(
      friendly ? "JOURNAL_FAILED" : "DB_ERROR",
      friendly ??
        logAndSanitize(
          e,
          "advance.repayment.reverse",
          "Operasi database gagal",
        ),
    );
  }
}

export async function listEmployeeAdvanceRepayments(
  options: ListEmployeeAdvanceRepaymentsOptions = {},
): Promise<ApiResult<EmployeeAdvanceRepaymentListRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat cicilan kasbon");
  }
  const limit = Math.min(options.limit ?? 100, 500);
  const conds = [
    eq(employeeAdvanceRepayments.outletId, session.user.outletId),
  ];
  if (options.advanceId) {
    conds.push(eq(employeeAdvanceRepayments.advanceId, options.advanceId));
  }
  if (options.employeeId) {
    conds.push(eq(employeeAdvanceRepayments.employeeId, options.employeeId));
  }

  const rows = await db
    .select({
      r: employeeAdvanceRepayments,
      employeeName: employees.fullName,
      advanceAmount: employeeAdvances.amount,
      advanceIssuedDate: employeeAdvances.issuedDate,
      bankName: bankAccounts.bankName,
      accountName: bankAccounts.accountName,
      accountNumber: bankAccounts.accountNumber,
      createdByName: users.name,
    })
    .from(employeeAdvanceRepayments)
    .innerJoin(
      employees,
      eq(employees.id, employeeAdvanceRepayments.employeeId),
    )
    .innerJoin(
      employeeAdvances,
      eq(employeeAdvances.id, employeeAdvanceRepayments.advanceId),
    )
    .leftJoin(
      bankAccounts,
      eq(bankAccounts.id, employeeAdvanceRepayments.bankAccountId),
    )
    .leftJoin(users, eq(users.id, employeeAdvanceRepayments.createdBy))
    .where(and(...conds))
    .orderBy(desc(employeeAdvanceRepayments.occurredAt))
    .limit(limit);

  return ok(
    rows.map((row) => ({
      ...row.r,
      employeeName: row.employeeName,
      advanceAmount: Number(row.advanceAmount),
      advanceIssuedDate: String(row.advanceIssuedDate),
      bankLabel: bankLabelOf(
        row.bankName,
        row.accountName,
        row.accountNumber,
      ),
      createdByName: row.createdByName ?? null,
    })),
  );
}
