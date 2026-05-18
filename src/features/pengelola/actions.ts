"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pengelola } from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { createPengelolaSchema, updatePengelolaSchema } from "./schemas";
import {
  fetchPengelola,
  fetchPengelolaById,
  fetchTotalModalPengelola,
} from "./queries";
import {
  fail,
  ok,
  type ApiResult,
  type CreatePengelolaInput,
  type Pengelola,
  type PengelolaWithStats,
  type UpdatePengelolaInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export async function listPengelola(): Promise<
  ApiResult<PengelolaWithStats[]>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pengelola.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat pengelola");
  }
  return ok(await fetchPengelola(session.user.outletId));
}

export async function getPengelolaById(
  id: string,
): Promise<ApiResult<Pengelola>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pengelola.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat pengelola");
  }
  const row = await fetchPengelolaById(session.user.outletId, id);
  if (!row) return fail("NOT_FOUND", "Pengelola tidak ditemukan");
  return ok(row);
}

export async function getTotalModalPengelola(): Promise<
  ApiResult<{ total: number; count: number }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pengelola.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat pengelola");
  }
  return ok(await fetchTotalModalPengelola(session.user.outletId));
}

export async function createPengelola(
  input: CreatePengelolaInput,
): Promise<ApiResult<Pengelola>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pengelola.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak buat pengelola");
  }
  const parsed = createPengelolaSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;
  try {
    const [row] = await db
      .insert(pengelola)
      .values({
        outletId: session.user.outletId,
        fullName: v.fullName,
        nickname: v.nickname,
        nik: v.nik,
        email: v.email,
        phone: v.phone,
        address: v.address,
        dateOfBirth: v.dateOfBirth,
        bankName: v.bankName,
        bankAccountNumber: v.bankAccountNumber,
        bankAccountHolderName: v.bankAccountHolderName,
        modalDisetor: v.modalDisetor,
        userId: v.userId,
        status: v.status ?? "active",
        notes: v.notes,
        createdBy: session.user.id,
        updatedBy: session.user.id,
      })
      .returning();

    logAudit({
      eventType: "pengelola.create",
      userId: session.user.id,
      entityType: "pengelola",
      entityId: row.id,
      payload: {
        summary: `Tambah pengelola: ${row.fullName} (Rp ${row.modalDisetor.toLocaleString("id-ID")})`,
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit pengelola.create]", e));

    return ok(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "DB error";
    if (/ux_pengelola_outlet_name/.test(msg)) {
      return fail(
        "DUPLICATE_NAME",
        "Pengelola dengan nama ini sudah ada",
        "fullName",
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "pengelola.create", "Operasi database gagal"),
    );
  }
}

export async function updatePengelola(
  id: string,
  input: UpdatePengelolaInput,
): Promise<ApiResult<Pengelola>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pengelola.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak edit pengelola");
  }
  const parsed = updatePengelolaSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const existing = await fetchPengelolaById(session.user.outletId, id);
  if (!existing) return fail("NOT_FOUND", "Pengelola tidak ditemukan");

  const v = parsed.data;
  const exitedAt =
    v.status === "exited" && !existing.exitedAt
      ? new Date()
      : v.status && v.status !== "exited"
        ? null
        : existing.exitedAt;

  try {
    const [row] = await db
      .update(pengelola)
      .set({
        ...v,
        exitedAt,
        updatedAt: new Date(),
        updatedBy: session.user.id,
      })
      /* Sesi AE-63 audit P0 — outlet-scope di WHERE clause. */
      .where(
        and(
          eq(pengelola.id, id),
          eq(pengelola.outletId, session.user.outletId),
        ),
      )
      .returning();

    if (!row) {
      return fail(
        "NOT_FOUND",
        "Pengelola tidak ditemukan / outlet mismatch",
      );
    }

    logAudit({
      eventType: "pengelola.update",
      userId: session.user.id,
      entityType: "pengelola",
      entityId: id,
      payload: {
        summary: `Update pengelola: ${row.fullName}`,
        before: {
          modalDisetor: existing.modalDisetor,
          status: existing.status,
        },
        after: { modalDisetor: row.modalDisetor, status: row.status },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit pengelola.update]", e));

    return ok(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "DB error";
    if (/ux_pengelola_outlet_name/.test(msg)) {
      return fail("DUPLICATE_NAME", "Nama pengelola sudah ada", "fullName");
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "pengelola.update", "Operasi database gagal"),
    );
  }
}

export async function deletePengelola(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pengelola.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak hapus pengelola");
  }
  const existing = await fetchPengelolaById(session.user.outletId, id);
  if (!existing) return fail("NOT_FOUND", "Pengelola tidak ditemukan");
  /* Sesi AE-63 audit P0 — outlet-scope di WHERE. */
  await db
    .update(pengelola)
    .set({ deletedAt: new Date(), updatedBy: session.user.id })
    .where(
      and(
        eq(pengelola.id, id),
        eq(pengelola.outletId, session.user.outletId),
      ),
    );

  logAudit({
    eventType: "pengelola.delete",
    userId: session.user.id,
    entityType: "pengelola",
    entityId: id,
    payload: { summary: `Hapus pengelola: ${existing.fullName}` },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit pengelola.delete]", e));

  return ok({ id });
}
