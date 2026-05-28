"use server";

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  capitalMovements,
  creditorRepayments,
  creditors,
  investorStatementEmails,
  investors,
  pengelola,
  profitDistributionLines,
  profitDistributions,
  shareTransactions,
  withdrawalRequests,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { fail, ok, type ApiResult } from "./types";

/**
 * Sesi AE-160f — Module wipe untuk Investor / Pengelola / Kreditur.
 *
 * Owner request: clean slate karena data lama banyak yang salah. Mau input
 * ulang dengan data yang lebih akurat lewat CSV template baru.
 *
 * Strategy: HARD-DELETE seluruh tabel terkait dalam 1 transaction dengan
 * order yang respect FK constraint:
 *   1. withdrawal_requests          → ref investor + capital_movement
 *   2. creditor_repayments          → ref creditor
 *   3. profit_distribution_lines    → ref distribution header + capital_movement
 *   4. investor_statement_emails    → ref distribution + investor
 *   5. profit_distributions         → ref outlet
 *   6. share_transactions           → ref investor (from/to)
 *   7. capital_movements            → polymorphic ke investor/pengelola
 *   8. creditors                    → ref outlet
 *   9. pengelola                    → ref outlet
 *  10. investors                    → ref outlet
 *
 * Owner-only. Confirmation string wajib match supaya tidak bisa accidental
 * trigger. Plus log audit lengkap untuk audit trail (siapa wipe + kapan +
 * berapa row kena).
 */

const REQUIRED_CONFIRMATION = "HAPUS SEMUA";

export interface InvestorModuleSnapshot {
  investors: number;
  pengelola: number;
  creditors: number;
  capitalMovements: number;
  shareTransactions: number;
  withdrawalRequests: number;
  creditorRepayments: number;
  profitDistributions: number;
  profitDistributionLines: number;
  investorStatementEmails: number;
  totalRows: number;
}

async function requireOwner() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  if (session.user.role !== "owner") {
    throw new Error("FORBIDDEN_OWNER_ONLY");
  }
  return session;
}

/**
 * Hitung row count per tabel untuk konfirmasi pre-wipe. Filter ke outlet
 * scope. Tidak mengubah apapun — read-only.
 */
export async function getInvestorModuleSnapshot(): Promise<
  ApiResult<InvestorModuleSnapshot>
> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Login dulu");
  if (
    !hasPermission(session.user.role, "investor.view") &&
    !hasPermission(session.user.role, "pengelola.view")
  ) {
    return fail("FORBIDDEN", "Tidak punya akses lihat data investor");
  }
  const outletId = session.user.outletId;

  /* Soft-deleted rows juga di-count karena akan ikut ke-wipe (hard delete
   * tidak peduli deletedAt). Owner perlu tau total real, bukan visible only. */
  const [
    [investorCount],
    [pengelolaCount],
    [creditorCount],
    [capMovCount],
    [shareTrxCount],
    [withdrawCount],
    [repayCount],
    [distCount],
    [distLineCount],
    [stmtEmailCount],
  ] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(investors)
      .where(eq(investors.outletId, outletId)),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(pengelola)
      .where(eq(pengelola.outletId, outletId)),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(creditors)
      .where(eq(creditors.outletId, outletId)),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(capitalMovements)
      .where(eq(capitalMovements.outletId, outletId)),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(shareTransactions)
      .where(eq(shareTransactions.outletId, outletId)),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.outletId, outletId)),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(creditorRepayments)
      .where(eq(creditorRepayments.outletId, outletId)),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(profitDistributions)
      .where(eq(profitDistributions.outletId, outletId)),
    /* profit_distribution_lines tidak punya outletId direct — count via
     * subquery distribution headers di outlet ini. */
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(profitDistributionLines)
      .where(
        sql`${profitDistributionLines.distributionId} IN (SELECT id FROM ${profitDistributions} WHERE outlet_id = ${outletId})`,
      ),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(investorStatementEmails)
      .where(
        sql`${investorStatementEmails.distributionId} IN (SELECT id FROM ${profitDistributions} WHERE outlet_id = ${outletId})`,
      ),
  ]);

  const counts = {
    investors: Number(investorCount?.c ?? 0),
    pengelola: Number(pengelolaCount?.c ?? 0),
    creditors: Number(creditorCount?.c ?? 0),
    capitalMovements: Number(capMovCount?.c ?? 0),
    shareTransactions: Number(shareTrxCount?.c ?? 0),
    withdrawalRequests: Number(withdrawCount?.c ?? 0),
    creditorRepayments: Number(repayCount?.c ?? 0),
    profitDistributions: Number(distCount?.c ?? 0),
    profitDistributionLines: Number(distLineCount?.c ?? 0),
    investorStatementEmails: Number(stmtEmailCount?.c ?? 0),
  };
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  return ok({ ...counts, totalRows });
}

/**
 * Hard-wipe seluruh data module Investor / Pengelola / Kreditur untuk outlet
 * caller. Owner-only. Confirmation string wajib "HAPUS SEMUA". Idempotent
 * (kalau dijalankan 2x, kedua kali tidak ada efek karena tabel sudah kosong).
 *
 * BUKAN soft-delete. Row hilang permanen. Pakai snapshot DB (Neon point-in-
 * time recovery) kalau perlu rollback dalam 7 hari.
 */
export async function wipeInvestorModuleData(input: {
  confirmation: string;
}): Promise<
  ApiResult<{
    rowsDeleted: InvestorModuleSnapshot;
    completedAt: Date;
  }>
> {
  let session;
  try {
    session = await requireOwner();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AUTH_ERROR";
    if (msg === "FORBIDDEN_OWNER_ONLY") {
      return fail(
        "FORBIDDEN",
        "Hanya Owner yang bisa reset modul investor.",
      );
    }
    return fail("UNAUTHORIZED", "Login dulu sebagai Owner.");
  }

  if (input.confirmation !== REQUIRED_CONFIRMATION) {
    return fail(
      "CONFIRMATION_MISMATCH",
      `Ketik "${REQUIRED_CONFIRMATION}" persis untuk konfirmasi.`,
    );
  }

  const outletId = session.user.outletId;
  const snapshot = await getInvestorModuleSnapshot();
  if (!snapshot.success) {
    return fail("DB_ERROR", "Gagal hitung row count pre-wipe");
  }

  let rowsDeleted: InvestorModuleSnapshot;
  const now = new Date();
  try {
    /* Single transaction supaya atomic. Kalau salah satu DELETE gagal,
     * SEMUA rollback — tidak ada partial wipe yang bikin module corrupted. */
    await db.transaction(async (tx) => {
      /* Order matters: child → parent untuk respect FK constraint. */
      await tx
        .delete(withdrawalRequests)
        .where(eq(withdrawalRequests.outletId, outletId));
      await tx
        .delete(creditorRepayments)
        .where(eq(creditorRepayments.outletId, outletId));
      /* Lines + emails tidak punya outletId — pakai subquery distribution. */
      const distRows = await tx
        .select({ id: profitDistributions.id })
        .from(profitDistributions)
        .where(eq(profitDistributions.outletId, outletId));
      const distIds = distRows.map((r) => r.id);
      if (distIds.length > 0) {
        await tx
          .delete(profitDistributionLines)
          .where(inArray(profitDistributionLines.distributionId, distIds));
        await tx
          .delete(investorStatementEmails)
          .where(inArray(investorStatementEmails.distributionId, distIds));
      }
      await tx
        .delete(profitDistributions)
        .where(eq(profitDistributions.outletId, outletId));
      await tx
        .delete(shareTransactions)
        .where(eq(shareTransactions.outletId, outletId));
      await tx
        .delete(capitalMovements)
        .where(eq(capitalMovements.outletId, outletId));
      await tx.delete(creditors).where(eq(creditors.outletId, outletId));
      await tx.delete(pengelola).where(eq(pengelola.outletId, outletId));
      await tx.delete(investors).where(eq(investors.outletId, outletId));
    });
    rowsDeleted = snapshot.data;
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(
        e,
        "investor-module.wipe",
        "Wipe gagal — transaction rolled back, data tetap utuh",
      ),
    );
  }

  await logAudit({
    eventType: "investor_module.wipe",
    userId: session.user.id,
    entityType: "outlet",
    entityId: outletId,
    payload: {
      summary: `Wipe modul investor: hapus ${rowsDeleted.totalRows} row total (investor, pengelola, kreditur + semua transaksi)`,
      before: rowsDeleted,
      context: {
        confirmation: REQUIRED_CONFIRMATION,
        deletedAt: now.toISOString(),
        snapshotPerTable: rowsDeleted,
      },
    },
    metadata: { outletId, actorRole: session.user.role },
  });

  return ok({ rowsDeleted, completedAt: now });
}
