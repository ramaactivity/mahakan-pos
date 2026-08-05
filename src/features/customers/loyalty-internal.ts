import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { auth } from "@/lib/auth";

/**
 * Internal loyalty helpers — dipisah dari actions.ts (`"use server"`) supaya
 * fungsi yang menerima DbTx / dipanggil fire-and-forget TIDAK ke-expose
 * sebagai server action publik (security: tanpa auth, bisa dipanggil
 * arbitrary client untuk transactionId apa pun). Pattern sama dengan
 * src/features/finance/settlement-generate.ts.
 *
 * File ini server-only; dipanggil dari transactions/actions.ts
 * (createTransaction, closeOpenBill, void/refund flows).
 */

/**
 * Decrement points balance atomically as part of a redemption. Caller passes
 * its own DbTx so the decrement is in the same DB transaction as the sale —
 * if the sale rolls back, the balance change rolls back too.
 *
 * Returns the customer row AFTER the decrement so the caller can include
 * the new balance in the audit summary + receipt.
 *
 * IMPORTANT: caller must validate `points <= currentBalance` BEFORE calling.
 * This helper does not re-check (the SQL update would silently produce a
 * negative balance otherwise — there's no DB-level non-negative constraint
 * because our schema uses bigint signed).
 */
export async function bumpCustomerRedeemInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  customerId: string,
  points: number,
  userId: string,
): Promise<{ id: string; totalPoints: number; name: string; phone: string }> {
  if (points <= 0) {
    throw new Error("INVALID_REDEMPTION_POINTS");
  }
  const { customers: customersTable } = await import("@/db/schema");
  const { eq: eqOp } = await import("drizzle-orm");
  const [updated] = await tx
    .update(customersTable)
    .set({
      totalPoints: sql`${customersTable.totalPoints} - ${points}`,
      updatedAt: new Date(),
      updatedBy: userId,
    })
    .where(eqOp(customersTable.id, customerId))
    .returning();
  if (updated.totalPoints < 0) {
    // Race: someone else redeemed concurrently between our pre-flight
    // balance check and this update. Throw so the surrounding DB tx
    // rolls back cleanly.
    throw new Error("INSUFFICIENT_POINTS_RACE");
  }
  return {
    id: updated.id,
    totalPoints: updated.totalPoints,
    name: updated.name,
    phone: updated.phone,
  };
}

/**
 * Apply earned points to a customer atomically inside a transaction.
 * Caller (createTransaction / closeOpenBill) passes its own DbTx so the
 * earn happens in the same DB tx as the sale.
 *
 * Updates totalPoints += points, totalSpent += rupiahSpent.
 */
export async function bumpCustomerEarnInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  customerId: string,
  pointsEarned: number,
  rupiahSpent: number,
  userId: string,
): Promise<void> {
  if (pointsEarned <= 0 && rupiahSpent <= 0) return;
  await tx
    .update(customers)
    .set({
      totalPoints: sql`${customers.totalPoints} + ${pointsEarned}`,
      totalSpent: sql`${customers.totalSpent} + ${rupiahSpent}`,
      updatedAt: new Date(),
      updatedBy: userId,
    })
    .where(eq(customers.id, customerId));
}

/**
 * Idempotent earn for a paid transaction. Reads the transaction, validates
 * eligibility (status=paid + customerId set + not yet earned), then atomically
 * sets `transactions.loyaltyPointsEarned` + bumps the customer balance and
 * lifetime spend.
 *
 * Called once at the end of a paid sale (createTransaction) and once at the
 * end of closeOpenBill. saveAsOpenBill skips earn (still open) — earn fires
 * later when the bill is actually paid.
 *
 * Concurrency: the idempotency read (loyaltyPointsEarned === null) and the
 * award run inside ONE db.transaction with SELECT ... FOR UPDATE on the
 * transactions row — concurrent double-fire serializes, loser sees
 * alreadyEarned=true. (Pre-fix the read was outside any tx → double-award
 * race under concurrent retry.)
 */
export async function earnPointsForTransaction(
  transactionId: string,
): Promise<{ pointsEarned: number; alreadyEarned: boolean } | null> {
  const session = await auth();
  // Use lazy import to avoid circular dependency between customers and
  // transactions modules at module load.
  const { transactions } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { computePointsEarned } = await import("./types");
  const { logAudit } = await import("@/lib/audit/logger");

  const outcome = await db.transaction(async (tx) => {
    const [trx] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1)
      .for("update");
    if (!trx) return null;
    if (trx.status !== "paid") return null;
    if (trx.customerId === null) return null;
    if (trx.loyaltyPointsEarned !== null) {
      return {
        trx,
        pointsEarned: trx.loyaltyPointsEarned,
        alreadyEarned: true as const,
      };
    }
    const pointsEarned = computePointsEarned(trx.total);

    await tx
      .update(transactions)
      .set({
        loyaltyPointsEarned: pointsEarned,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transactionId));
    await bumpCustomerEarnInTx(
      tx,
      trx.customerId!,
      pointsEarned,
      trx.total,
      session?.user.id ?? trx.cashierId,
    );
    return { trx, pointsEarned, alreadyEarned: false as const };
  });

  if (!outcome) return null;
  if (outcome.alreadyEarned) {
    return { pointsEarned: outcome.pointsEarned, alreadyEarned: true };
  }
  const { trx, pointsEarned } = outcome;

  await logAudit({
    eventType: "transaction.points.earned",
    userId: session?.user.id ?? trx.cashierId,
    entityType: "transaction",
    entityId: transactionId,
    payload: {
      summary: `+${pointsEarned} poin pada TRX ${trx.transactionNumber} (Rp${trx.total.toLocaleString("id-ID")})`,
      context: {
        transactionNumber: trx.transactionNumber,
        customerId: trx.customerId,
        rupiahSpent: trx.total,
        pointsEarned,
      },
    },
    metadata: {
      outletId: trx.outletId,
      actorRole: session?.user.role ?? "system",
    },
  });

  return { pointsEarned, alreadyEarned: false };
}

/**
 * Sesi AE-62i — Restore loyalty points saat transaksi di-refund / void / edit.
 *
 * Behavior:
 *   - Full refund (status='refunded'): decrement earned points (full claw-back),
 *     restore redeemed points (full re-credit). transaction.loyaltyPointsEarned
 *     set ke 0 supaya tidak double-revert kalau re-fired.
 *   - Partial refund (status='partially_refunded'): pro-rate points earned vs
 *     refundedAmount. Redeem points NOT restored (partial doesn't reclaim
 *     redemption — redemption tied ke whole transaction).
 *   - Void: same as full refund (both points fully reversed).
 *
 * Pre AE-62i: refund silent skip → customer keep points dari refunded sale +
 * lose redeemed points → loyalty ratchet bug.
 *
 * Idempotent via transaction.loyaltyPointsEarned == 0 setelah revert.
 *
 * Caller passes DbTx supaya same atomic unit dengan refund/void action.
 */
export async function restorePointsOnTransactionRefund(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  transactionId: string,
  args: {
    refundKind: "full" | "partial" | "void";
    /** Untuk partial refund: rupiah yang di-refund (total - refundedAmount). */
    refundAmount?: number;
    actorId: string;
  },
): Promise<{ pointsClawedBack: number; pointsRestored: number }> {
  const { transactions } = await import("@/db/schema");
  const { eq, sql: drizzleSql } = await import("drizzle-orm");
  const { computePointsEarned } = await import("./types");

  const [trx] = await tx
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);
  if (!trx) return { pointsClawedBack: 0, pointsRestored: 0 };
  if (!trx.customerId)
    return { pointsClawedBack: 0, pointsRestored: 0 };

  let pointsClawedBack = 0;
  let pointsRestored = 0;
  const earned = trx.loyaltyPointsEarned ?? 0;
  const redeemed = trx.loyaltyPointsRedeemed ?? 0;

  if (args.refundKind === "full" || args.refundKind === "void") {
    // Full claw-back of earned + re-credit of redeemed.
    pointsClawedBack = earned;
    pointsRestored = redeemed;
    if (pointsClawedBack > 0 || pointsRestored > 0) {
      await tx
        .update(customers)
        .set({
          totalPoints: drizzleSql`${customers.totalPoints} - ${pointsClawedBack} + ${pointsRestored}`,
          updatedAt: new Date(),
          updatedBy: args.actorId,
        })
        .where(eq(customers.id, trx.customerId));
      await tx
        .update(transactions)
        .set({
          loyaltyPointsEarned: 0,
          loyaltyPointsRedeemed: 0,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transactionId));
    }
  } else if (args.refundKind === "partial" && earned > 0 && trx.total > 0) {
    // Pro-rate: clawback proportional ke refundAmount / total.
    const refundAmt = args.refundAmount ?? 0;
    if (refundAmt > 0 && refundAmt < trx.total) {
      const pointsForRefundedShare = computePointsEarned(refundAmt);
      // Cap by what's still earned (handle multiple partial refunds).
      pointsClawedBack = Math.min(earned, pointsForRefundedShare);
      if (pointsClawedBack > 0) {
        await tx
          .update(customers)
          .set({
            totalPoints: drizzleSql`${customers.totalPoints} - ${pointsClawedBack}`,
            updatedAt: new Date(),
            updatedBy: args.actorId,
          })
          .where(eq(customers.id, trx.customerId));
        await tx
          .update(transactions)
          .set({
            loyaltyPointsEarned: earned - pointsClawedBack,
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, transactionId));
      }
    }
  }

  return { pointsClawedBack, pointsRestored };
}
