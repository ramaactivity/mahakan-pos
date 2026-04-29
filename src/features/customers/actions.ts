"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import {
  fetchCustomerById,
  fetchCustomerByPhone,
  fetchCustomers,
  fetchCustomerStats,
  fetchTopCustomers,
} from "./queries";
import {
  normalisePhone,
  type Customer,
  type FindOrCreateCustomerInput,
  type ListCustomersOptions,
  type ListCustomersResult,
  type UpdateCustomerInput,
} from "./types";

// Local result helpers — pure helpers + types live in ./types so they can
// be imported by client components without dragging the "use server"
// runtime in.
import { ok, fail, type ApiResult } from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

// ---------- Reads ----------

export async function listCustomers(
  opts: ListCustomersOptions = {},
): Promise<ApiResult<ListCustomersResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "customer.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat customer");
  }
  const result = await fetchCustomers(session.user.outletId, opts);
  return ok(result);
}

export async function getCustomer(
  id: string,
): Promise<ApiResult<Customer>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "customer.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat customer");
  }
  const row = await fetchCustomerById(id);
  if (!row) return fail("NOT_FOUND", "Customer tidak ditemukan");
  return ok(row);
}

export async function lookupCustomerByPhone(
  rawPhone: string,
): Promise<ApiResult<Customer | null>> {
  const session = await requireSession();
  // POS lookup — staff can see member info during checkout.
  const phone = normalisePhone(rawPhone);
  if (!phone) return ok(null);
  const row = await fetchCustomerByPhone(session.user.outletId, phone);
  return ok(row);
}

export async function topCustomers(
  limit = 10,
): Promise<ApiResult<Customer[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "customer.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat customer");
  }
  const rows = await fetchTopCustomers(session.user.outletId, limit);
  return ok(rows);
}

export async function customerStats(): Promise<
  ApiResult<{ total: number; totalPointsOutstanding: number; lifetimeSpend: number }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "customer.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat customer");
  }
  return ok(await fetchCustomerStats(session.user.outletId));
}

// ---------- Writes ----------

/**
 * Idempotent find-or-create. Used by createTransaction during checkout
 * when kasir provides a phone. Returns existing customer if phone matches,
 * else creates new with the supplied name. Name update is intentional —
 * if customer's name was previously typed differently (typo), the latest
 * label wins so kasir can fix on the fly.
 */
export async function findOrCreateCustomer(
  input: FindOrCreateCustomerInput,
): Promise<ApiResult<Customer>> {
  const session = await requireSession();
  const phone = normalisePhone(input.phone);
  if (!phone) {
    return fail("INVALID_PHONE", "Nomor telepon tidak valid (min 6 digit)");
  }
  const name = input.name.trim();
  if (name.length === 0) {
    return fail("INVALID_NAME", "Nama wajib diisi");
  }
  if (name.length > 80) {
    return fail("INVALID_NAME", "Nama maksimal 80 karakter");
  }

  const existing = await fetchCustomerByPhone(session.user.outletId, phone);
  if (existing) {
    // Update name if it changed (kasir typo fix). Notes only set on create.
    if (existing.name !== name) {
      const [updated] = await db
        .update(customers)
        .set({ name, updatedAt: new Date(), updatedBy: session.user.id })
        .where(eq(customers.id, existing.id))
        .returning();
      return ok(updated);
    }
    return ok(existing);
  }

  const [created] = await db
    .insert(customers)
    .values({
      outletId: session.user.outletId,
      phone,
      name,
      notes: input.notes ?? null,
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning();

  await logAudit({
    eventType: "customer.create",
    userId: session.user.id,
    entityType: "customer",
    entityId: created.id,
    payload: {
      summary: `Customer baru: ${name} (${phone})`,
      after: { name, phone, notes: input.notes ?? null },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  return ok(created);
}

export async function updateCustomer(
  input: UpdateCustomerInput,
): Promise<ApiResult<Customer>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "customer.update")) {
    return fail("FORBIDDEN", "Tidak punya hak update customer");
  }

  const current = await fetchCustomerById(input.id);
  if (!current) return fail("NOT_FOUND", "Customer tidak ditemukan");
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Customer dari outlet lain");
  }

  const patch: Partial<typeof customers.$inferInsert> = {
    updatedAt: new Date(),
    updatedBy: session.user.id,
  };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length === 0 || name.length > 80) {
      return fail("INVALID_NAME", "Nama 1-80 karakter");
    }
    patch.name = name;
  }
  if (input.phone !== undefined) {
    const phone = normalisePhone(input.phone);
    if (!phone) return fail("INVALID_PHONE", "Nomor telepon tidak valid");
    // Conflict guard
    const conflict = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.outletId, session.user.outletId),
          eq(customers.phone, phone),
          isNull(customers.deletedAt),
        ),
      )
      .limit(1);
    if (conflict.length > 0 && conflict[0].id !== current.id) {
      return fail("PHONE_CONFLICT", "Nomor sudah dipakai customer lain");
    }
    patch.phone = phone;
  }
  if (input.notes !== undefined) {
    patch.notes = input.notes;
  }

  const [updated] = await db
    .update(customers)
    .set(patch)
    .where(eq(customers.id, current.id))
    .returning();

  await logAudit({
    eventType: "customer.update",
    userId: session.user.id,
    entityType: "customer",
    entityId: current.id,
    payload: {
      summary: `Edit customer ${updated.name} (${updated.phone})`,
      before: { name: current.name, phone: current.phone, notes: current.notes },
      after: { name: updated.name, phone: updated.phone, notes: updated.notes },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  return ok(updated);
}

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

  const [trx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);
  if (!trx) return null;
  if (trx.status !== "paid") return null;
  if (trx.customerId === null) return null;
  if (trx.loyaltyPointsEarned !== null) {
    return { pointsEarned: trx.loyaltyPointsEarned, alreadyEarned: true };
  }
  const pointsEarned = computePointsEarned(trx.total);

  await db.transaction(async (tx) => {
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
  });

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
