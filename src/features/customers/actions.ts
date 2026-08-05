"use server";

import { and, eq, isNull } from "drizzle-orm";
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

/* Internal loyalty helpers (bumpCustomerRedeemInTx, bumpCustomerEarnInTx,
 * earnPointsForTransaction, restorePointsOnTransactionRefund) pindah ke
 * ./loyalty-internal.ts (`import "server-only"`) — fungsi yang menerima
 * DbTx / dipanggil fire-and-forget TIDAK boleh ke-expose sebagai server
 * action publik dari file "use server" ini (tanpa auth check, arbitrary
 * client bisa invoke untuk transactionId apa pun). Pattern sama dengan
 * src/features/finance/settlement-generate.ts. */

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
