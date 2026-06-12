"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { errorChainIncludes, logAndSanitize } from "@/lib/server-error";
import { fetchSupplierById, fetchSuppliers } from "./queries";
import {
  createSupplierSchema,
  updateSupplierSchema,
} from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type CreateSupplierInput,
  type ListSuppliersOptions,
  type Supplier,
  type UpdateSupplierInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export async function listSuppliers(
  opts: ListSuppliersOptions = {},
): Promise<ApiResult<Supplier[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "supplier.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat supplier");
  }
  return ok(await fetchSuppliers(session.user.outletId, opts));
}

export async function getSupplier(
  id: string,
): Promise<ApiResult<Supplier | null>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "supplier.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat supplier");
  }
  return ok(await fetchSupplierById(id, session.user.outletId));
}

export async function createSupplier(
  input: CreateSupplierInput,
): Promise<ApiResult<Supplier>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "supplier.create")) {
    return fail("FORBIDDEN", "Tidak punya hak buat supplier");
  }
  const parsed = createSupplierSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  try {
    const [created] = await db
      .insert(suppliers)
      .values({
        outletId: session.user.outletId,
        name: v.name,
        contact: v.contact ?? null,
        category: v.category ?? null,
        defaultPaymentTermDays: v.defaultPaymentTermDays,
        notes: v.notes ?? null,
        createdBy: session.user.id,
      })
      .returning();
    if (!created) return fail("DB_ERROR", "Gagal buat supplier");

    await logAudit({
      eventType: "supplier.create",
      userId: session.user.id,
      entityType: "supplier",
      entityId: created.id,
      payload: {
        summary: `Tambah supplier ${created.name}`,
        after: created,
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    return ok(created);
  } catch (e) {
    /* Sesi AE-180 — drizzle 0.45 bungkus error DB di .cause. */
    if (errorChainIncludes(e, "ux_suppliers_outlet_name_active")) {
      return fail(
        "CONFLICT",
        `Supplier dengan nama "${v.name}" sudah ada`,
        "name",
      );
    }
    return fail("DB_ERROR", logAndSanitize(e, "suppliers", "Operasi database gagal"));
  }
}

export async function updateSupplier(
  id: string,
  input: UpdateSupplierInput,
): Promise<ApiResult<Supplier>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "supplier.update")) {
    return fail("FORBIDDEN", "Tidak punya hak edit supplier");
  }
  const parsed = updateSupplierSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const before = await fetchSupplierById(id, session.user.outletId);
  if (!before) return fail("NOT_FOUND", "Supplier tidak ditemukan");

  try {
    const updateValues: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: session.user.id,
    };
    if (v.name !== undefined) updateValues.name = v.name;
    if (v.contact !== undefined) updateValues.contact = v.contact;
    if (v.category !== undefined) updateValues.category = v.category;
    if (v.defaultPaymentTermDays !== undefined)
      updateValues.defaultPaymentTermDays = v.defaultPaymentTermDays;
    if (v.notes !== undefined) updateValues.notes = v.notes;
    if (v.isActive !== undefined) updateValues.isActive = v.isActive;

    const [updated] = await db
      .update(suppliers)
      .set(updateValues)
      .where(
        and(
          eq(suppliers.id, id),
          eq(suppliers.outletId, session.user.outletId),
          isNull(suppliers.deletedAt),
        ),
      )
      .returning();
    if (!updated) return fail("NOT_FOUND", "Supplier tidak ditemukan");

    await logAudit({
      eventType: "supplier.update",
      userId: session.user.id,
      entityType: "supplier",
      entityId: id,
      payload: {
        summary: `Edit supplier ${updated.name}`,
        before,
        after: updated,
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    return ok(updated);
  } catch (e) {
    /* Sesi AE-180 — drizzle 0.45 bungkus error DB di .cause. */
    if (errorChainIncludes(e, "ux_suppliers_outlet_name_active")) {
      return fail("CONFLICT", "Nama supplier sudah dipakai", "name");
    }
    return fail("DB_ERROR", logAndSanitize(e, "suppliers", "Operasi database gagal"));
  }
}

export async function deleteSupplier(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "supplier.delete")) {
    return fail(
      "FORBIDDEN",
      "Hanya Owner yang boleh hapus supplier",
    );
  }

  const before = await fetchSupplierById(id, session.user.outletId);
  if (!before) return fail("NOT_FOUND", "Supplier tidak ditemukan");

  await db
    .update(suppliers)
    .set({
      deletedAt: new Date(),
      isActive: false,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(
      and(
        eq(suppliers.id, id),
        eq(suppliers.outletId, session.user.outletId),
      ),
    );

  await logAudit({
    eventType: "supplier.delete",
    userId: session.user.id,
    entityType: "supplier",
    entityId: id,
    payload: {
      summary: `Hapus supplier ${before.name}`,
      before,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  return ok({ id });
}
