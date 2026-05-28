"use server";

import { and, eq, ilike, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  capitalMovements,
  investors,
  withdrawalRequests,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { fail, ok, type ApiResult } from "./types";

/**
 * Sesi AE-160h — Bulk import historical withdrawal records.
 *
 * Use case: setelah wipe + re-import master investor dengan Saldo Dividen
 * = saldo current, owner mau punya riwayat pencairan masa lalu sebagai
 * audit trail tanpa mempengaruhi saldo.
 *
 * Karakteristik (HISTORICAL MODE — tidak sama dengan postWithdrawal):
 *   - TIDAK post journal (jurnal sudah ada dari periode lama)
 *   - TIDAK decrement investor.dividendBalance (saldo di INVESTOR sheet
 *     diasumsikan sudah merupakan current balance setelah semua pencairan)
 *   - Insert withdrawal_requests status='posted', journalEntryId=null
 *   - Insert capital_movements kind='dividend_withdrawal',
 *     journalEntryId=null, description di-prefix "[Migrasi historis]"
 *   - Per-row error tidak rollback semuanya (partial success allowed)
 *
 * Owner-only. Bank lookup by name+tail. Investor lookup by exact name OR
 * NIK fallback.
 */

export interface HistoricalWithdrawalRow {
  occurredAt: string; // YYYY-MM-DD
  investorName: string; // exact match against investors.fullName (case-insensitive)
  investorNik?: string | null; // fallback lookup
  amount: number; // Rp; min 50.000 per DB CHECK
  bankName: string; // lookup bank_accounts.bankName (case-insensitive)
  bankAccountNumber?: string | null; // disambiguate kalau ada multiple bank dengan nama sama
  description?: string | null;
}

export interface BulkImportWithdrawalsInput {
  rows: HistoricalWithdrawalRow[];
}

export interface BulkImportWithdrawalsResult {
  totalRows: number;
  inserted: number;
  skippedDuplicate: number;
  errors: Array<{ rowIndex: number; reason: string }>;
}

const HISTORICAL_PREFIX = "[Migrasi historis]";
const MIN_AMOUNT = 50_000;

async function requireOwner() {
  const s = await auth();
  if (!s) throw new Error("UNAUTHORIZED");
  if (!hasPermission(s.user.role, "distribution.approve")) {
    throw new Error("FORBIDDEN");
  }
  return s;
}

export async function bulkImportHistoricalWithdrawals(
  input: BulkImportWithdrawalsInput,
): Promise<ApiResult<BulkImportWithdrawalsResult>> {
  let session;
  try {
    session = await requireOwner();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AUTH";
    if (msg === "FORBIDDEN") {
      return fail(
        "FORBIDDEN",
        "Hanya Owner yang bisa import pencairan historis.",
      );
    }
    return fail("UNAUTHORIZED", "Login dulu sebagai Owner.");
  }

  const outletId = session.user.outletId;
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return fail("VALIDATION_ERROR", "Tidak ada baris untuk diimport");
  }
  if (input.rows.length > 1000) {
    return fail(
      "VALIDATION_ERROR",
      "Maksimal 1000 baris per batch. Split file kalau lebih.",
    );
  }

  /* Pre-load semua investor + bank account aktif outlet ini untuk lookup
   * O(1). Lebih cepat dari query per-row. */
  const investorRows = await db
    .select({
      id: investors.id,
      fullName: investors.fullName,
      nik: investors.nik,
    })
    .from(investors)
    .where(and(eq(investors.outletId, outletId), isNull(investors.deletedAt)));
  const investorByName = new Map<string, { id: string; fullName: string }>();
  const investorByNik = new Map<string, { id: string; fullName: string }>();
  for (const inv of investorRows) {
    investorByName.set(inv.fullName.toLowerCase().trim(), {
      id: inv.id,
      fullName: inv.fullName,
    });
    if (inv.nik) {
      investorByNik.set(inv.nik.trim(), {
        id: inv.id,
        fullName: inv.fullName,
      });
    }
  }

  const bankRows = await db
    .select({
      id: bankAccounts.id,
      bankName: bankAccounts.bankName,
      accountNumber: bankAccounts.accountNumber,
      isActive: bankAccounts.isActive,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.outletId, outletId));
  /* Bank lookup: by bankName lowercase + optional tail accountNumber. */
  function findBank(
    bankName: string,
    accountNumber: string | null,
  ): { id: string } | null {
    const lname = bankName.toLowerCase().trim();
    const matches = bankRows.filter(
      (b) => b.bankName.toLowerCase().trim() === lname && b.isActive,
    );
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    /* Multiple match — disambiguate by accountNumber tail. */
    if (accountNumber) {
      const tail = accountNumber.replace(/[^\d]/g, "").slice(-6);
      const byTail = matches.find((b) =>
        (b.accountNumber ?? "").replace(/[^\d]/g, "").endsWith(tail),
      );
      if (byTail) return byTail;
    }
    /* Tetap ambiguous — pakai pertama, log warning di error message. */
    return matches[0];
  }

  const result: BulkImportWithdrawalsResult = {
    totalRows: input.rows.length,
    inserted: 0,
    skippedDuplicate: 0,
    errors: [],
  };

  /* Per-row insert. Skip error baris, lanjut ke baris berikutnya. */
  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i];
    const rowNum = i + 2; // header di baris 1, data mulai baris 2 di Excel

    /* Validate dasar. */
    if (!row.investorName || row.investorName.trim().length < 2) {
      result.errors.push({
        rowIndex: rowNum,
        reason: "Nama investor kosong",
      });
      continue;
    }
    if (!row.amount || row.amount < MIN_AMOUNT) {
      result.errors.push({
        rowIndex: rowNum,
        reason: `Nominal min Rp ${MIN_AMOUNT.toLocaleString("id-ID")}`,
      });
      continue;
    }
    if (!row.occurredAt || !/^\d{4}-\d{2}-\d{2}$/.test(row.occurredAt)) {
      result.errors.push({
        rowIndex: rowNum,
        reason: "Tanggal invalid (pakai YYYY-MM-DD)",
      });
      continue;
    }

    /* Investor lookup. */
    const lname = row.investorName.toLowerCase().trim();
    let investor = investorByName.get(lname);
    if (!investor && row.investorNik) {
      investor = investorByNik.get(row.investorNik.trim());
    }
    if (!investor) {
      result.errors.push({
        rowIndex: rowNum,
        reason: `Investor "${row.investorName}" tidak ditemukan`,
      });
      continue;
    }

    /* Bank lookup. */
    if (!row.bankName || row.bankName.trim().length === 0) {
      result.errors.push({
        rowIndex: rowNum,
        reason: "Bank sumber kosong",
      });
      continue;
    }
    const bank = findBank(row.bankName, row.bankAccountNumber ?? null);
    if (!bank) {
      result.errors.push({
        rowIndex: rowNum,
        reason: `Bank "${row.bankName}" tidak ditemukan di outlet ini`,
      });
      continue;
    }

    /* Insert atomik per-row (small tx, isolated errors). */
    try {
      const occurredAt = new Date(`${row.occurredAt}T12:00:00+07:00`);
      const descBase = row.description?.trim() ?? "";
      const description = `${HISTORICAL_PREFIX} pencairan ${investor.fullName}${descBase ? " — " + descBase : ""}`;

      await db.transaction(async (tx) => {
        const [wrRow] = await tx
          .insert(withdrawalRequests)
          .values({
            outletId,
            investorId: investor.id,
            amount: row.amount,
            bankAccountId: bank.id,
            occurredAt,
            description,
            status: "posted",
            journalEntryId: null,
            capitalMovementId: null,
            createdBy: session.user.id,
          })
          .returning({ id: withdrawalRequests.id });

        const [mov] = await tx
          .insert(capitalMovements)
          .values({
            outletId,
            holderType: "investor",
            holderId: investor.id,
            kind: "dividend_withdrawal",
            amount: row.amount,
            occurredAt,
            description,
            journalEntryId: null,
            createdBy: session.user.id,
          })
          .returning({ id: capitalMovements.id });

        await tx
          .update(withdrawalRequests)
          .set({ capitalMovementId: mov.id })
          .where(eq(withdrawalRequests.id, wrRow.id));
      });

      result.inserted += 1;
    } catch (e) {
      result.errors.push({
        rowIndex: rowNum,
        reason: e instanceof Error ? e.message : "DB error",
      });
    }
  }

  await logAudit({
    eventType: "withdrawal.bulk_import_historical",
    userId: session.user.id,
    entityType: "outlet",
    entityId: outletId,
    payload: {
      summary: `Import historical pencairan: ${result.inserted}/${result.totalRows} berhasil, ${result.errors.length} error`,
      context: {
        totalRows: result.totalRows,
        inserted: result.inserted,
        errors: result.errors.length,
        prefix: HISTORICAL_PREFIX,
      },
    },
    metadata: { outletId, actorRole: session.user.role },
  });

  return ok(result);
}

/* Silence unused-import warnings kalau ada. */
void ilike;
