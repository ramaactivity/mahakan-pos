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
import { startOfWibDateUtc } from "@/features/cash/helpers";
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

/* Sesi AE-60 — Buat kasbon baru. Status default 'pending'. Saat next
 * payroll compute, akan auto-link ke periode tersebut. */
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

  const [created] = await db
    .insert(employeeAdvances)
    .values({
      outletId: session.user.outletId,
      employeeId: v.employeeId,
      amount: v.amount,
      reason: v.reason ?? null,
      issuedDate: v.issuedDate,
      status: "pending",
      createdBy: session.user.id,
    })
    .returning();

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
 * Tidak akan dipotong dari payroll. */
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

  const [updated] = await db
    .update(employeeAdvances)
    .set({
      status: "forgiven",
      resolvedAt: new Date(),
      resolvedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(employeeAdvances.id, id))
    .returning();

  logAudit({
    eventType: "advance.forgive",
    userId: session.user.id,
    entityType: "employee_advance",
    entityId: id,
    payload: {
      summary: `Kasbon Rp ${Number(current.amount).toLocaleString("id-ID")} di-forgive`,
      before: { status: current.status },
      after: { status: "forgiven" },
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
 * TIDAK memposting jurnal — alasannya ada di komentar skema
 * `employee_advance_repayments` (kasbon memang belum masuk pembukuan).
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

  let bankLabel: string | null = null;
  if (v.method === "transfer" && v.bankAccountId) {
    const [bank] = await db
      .select({
        id: bankAccounts.id,
        outletId: bankAccounts.outletId,
        isActive: bankAccounts.isActive,
        bankName: bankAccounts.bankName,
        accountName: bankAccounts.accountName,
        accountNumber: bankAccounts.accountNumber,
      })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, v.bankAccountId))
      .limit(1);
    if (!bank) return fail("NOT_FOUND", "Rekening tidak ditemukan");
    if (bank.outletId !== session.user.outletId) {
      return fail("FORBIDDEN", "Rekening dari outlet lain");
    }
    if (!bank.isActive) {
      return fail("INVALID_STATE", "Rekening sudah tidak aktif");
    }
    bankLabel = bankLabelOf(
      bank.bankName,
      bank.accountName,
      bank.accountNumber,
    );
  }

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
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "advance.repayment.post", "Operasi database gagal"),
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
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "advance.repayment.reverse", "Operasi database gagal"),
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
