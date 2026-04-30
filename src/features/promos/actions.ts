"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { promos } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import {
  fetchActivePromos,
  fetchPromoById,
  fetchPromos,
  type ListPromosOptions,
} from "./queries";
import { createPromoSchema, updatePromoSchema } from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type CreatePromoInput,
  type Promo,
  type PromoWithStats,
  type UpdatePromoInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export async function listPromos(
  status?: ListPromosOptions["status"],
): Promise<ApiResult<PromoWithStats[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "promo.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat promo");
  }
  return ok(
    await fetchPromos({ outletId: session.user.outletId, status }),
  );
}

/** POS endpoint — list of currently-active promos (status=active only).
 *  Eligibility per cart computed client-side using shared evaluatePromo. */
export async function listActivePromosForPos(): Promise<ApiResult<Promo[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pos.promo.apply")) {
    return fail("FORBIDDEN", "Tidak punya hak apply promo");
  }
  return ok(await fetchActivePromos(session.user.outletId));
}

export async function getPromo(id: string): Promise<ApiResult<Promo>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "promo.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat promo");
  }
  const row = await fetchPromoById(id);
  if (!row) return fail("NOT_FOUND", "Promo tidak ditemukan");
  if (row.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Promo dari outlet lain");
  }
  return ok(row);
}

export async function createPromo(
  input: CreatePromoInput,
): Promise<ApiResult<Promo>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "promo.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak buat promo");
  }
  const parsed = createPromoSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail("VALIDATION_ERROR", first.message, first.path.join("."));
  }

  const v = parsed.data;
  const [row] = await db
    .insert(promos)
    .values({
      outletId: session.user.outletId,
      name: v.name,
      description: v.description ?? null,
      discountType: v.discountType,
      discountValue: v.discountValue,
      maxDiscountAmount: v.maxDiscountAmount ?? null,
      scope: v.scope,
      scopeCategoryIds: v.scopeCategoryIds ?? null,
      minSubtotal: v.minSubtotal ?? null,
      applicableOrderTypes: v.applicableOrderTypes ?? null,
      applicablePaymentMethods: v.applicablePaymentMethods ?? null,
      startDate: v.startDate ?? null,
      endDate: v.endDate ?? null,
      daysOfWeek: v.daysOfWeek ?? null,
      startTime: v.startTime ?? null,
      endTime: v.endTime ?? null,
      maxTotalUses: v.maxTotalUses ?? null,
      requiresApproval: v.requiresApproval,
      status: v.status,
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning();

  await logAudit({
    eventType: "promo.create",
    userId: session.user.id,
    entityType: "promo",
    entityId: row.id,
    payload: { summary: `Buat promo "${row.name}" (${row.status})` },
  });

  return ok(row);
}

export async function updatePromo(
  input: UpdatePromoInput,
): Promise<ApiResult<Promo>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "promo.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak ubah promo");
  }
  const parsed = updatePromoSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail("VALIDATION_ERROR", first.message, first.path.join("."));
  }
  const v = parsed.data;

  const existing = await fetchPromoById(v.id);
  if (!existing) return fail("NOT_FOUND", "Promo tidak ditemukan");
  if (existing.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Promo dari outlet lain");
  }

  const [row] = await db
    .update(promos)
    .set({
      name: v.name,
      description: v.description ?? null,
      discountType: v.discountType,
      discountValue: v.discountValue,
      maxDiscountAmount: v.maxDiscountAmount ?? null,
      scope: v.scope,
      scopeCategoryIds: v.scopeCategoryIds ?? null,
      minSubtotal: v.minSubtotal ?? null,
      applicableOrderTypes: v.applicableOrderTypes ?? null,
      applicablePaymentMethods: v.applicablePaymentMethods ?? null,
      startDate: v.startDate ?? null,
      endDate: v.endDate ?? null,
      daysOfWeek: v.daysOfWeek ?? null,
      startTime: v.startTime ?? null,
      endTime: v.endTime ?? null,
      maxTotalUses: v.maxTotalUses ?? null,
      requiresApproval: v.requiresApproval,
      status: v.status,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(promos.id, v.id))
    .returning();

  await logAudit({
    eventType: "promo.update",
    userId: session.user.id,
    entityType: "promo",
    entityId: row.id,
    payload: {
      summary: `Edit promo "${row.name}"`,
      diff: {
        name: { before: existing.name, after: row.name },
        status: { before: existing.status, after: row.status },
      },
    },
  });

  return ok(row);
}

export async function deletePromo(id: string): Promise<ApiResult<null>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "promo.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak hapus promo");
  }
  const existing = await fetchPromoById(id);
  if (!existing) return fail("NOT_FOUND", "Promo tidak ditemukan");
  if (existing.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Promo dari outlet lain");
  }
  await db
    .update(promos)
    .set({
      deletedAt: new Date(),
      status: "archived",
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(and(eq(promos.id, id), isNull(promos.deletedAt)));

  await logAudit({
    eventType: "promo.delete",
    userId: session.user.id,
    entityType: "promo",
    entityId: id,
    payload: { summary: `Arsipkan promo "${existing.name}"` },
  });

  return ok(null);
}
