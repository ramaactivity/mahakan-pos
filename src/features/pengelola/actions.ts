"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { capitalMovements, pengelola } from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import {
  bulkImportPengelolaSchema,
  createPengelolaSchema,
  updatePengelolaSchema,
} from "./schemas";
import {
  fetchPengelola,
  fetchPengelolaById,
  fetchTotalModalPengelola,
} from "./queries";
import {
  fail,
  ok,
  type ApiResult,
  type BulkImportPengelolaInput,
  type BulkImportPengelolaResult,
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

// ============================================================================
// Bulk Import (Sesi AE-80 follow-up)
// ============================================================================

/**
 * CSV bulk import untuk pengelola. Mirror pattern bulkImportInvestors:
 *  - mode 'insert_only' (default): skip kalau fullName sudah ada
 *  - mode 'upsert': update field-nya pakai nilai CSV
 *  - dividendBalance optional → kalau di-set, replace + capital_movement
 *    kind='adjustment' trail dengan delta signed.
 */
export async function bulkImportPengelola(
  input: BulkImportPengelolaInput,
): Promise<ApiResult<BulkImportPengelolaResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pengelola.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak import pengelola");
  }
  const parsed = bulkImportPengelolaSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const { rows, mode } = parsed.data;

  const existing = await db
    .select({
      id: pengelola.id,
      fullName: pengelola.fullName,
      dividendBalance: pengelola.dividendBalance,
    })
    .from(pengelola)
    .where(
      and(
        eq(pengelola.outletId, session.user.outletId),
        isNull(pengelola.deletedAt),
      ),
    );
  const existingByName = new Map<string, { id: string; dividendBalance: number }>();
  for (const r of existing) {
    existingByName.set(r.fullName.trim().toLowerCase(), {
      id: r.id,
      dividendBalance: r.dividendBalance,
    });
  }

  const result: BulkImportPengelolaResult = {
    totalRows: rows.length,
    inserted: 0,
    updated: 0,
    skippedDuplicate: 0,
    errors: [],
  };

  const dedupedRows: Array<{
    rowIdx: number;
    values: typeof pengelola.$inferInsert;
    seedBalance: number | null;
  }> = [];
  const upsertTargets: Array<{
    rowIdx: number;
    existingId: string;
    values: Partial<typeof pengelola.$inferInsert>;
    oldBalance: number;
    newBalance: number | null;
  }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const matched = existingByName.get(r.fullName.trim().toLowerCase());
    if (matched) {
      if (mode === "upsert") {
        /* Sesi AE-178 — PARTIAL UPSERT: skip field null supaya re-upload
         * tidak nimpa data existing (mis. phone yang sudah ada di DB). */
        const vals: Partial<typeof pengelola.$inferInsert> = {
          fullName: r.fullName,
          modalDisetor: r.modalDisetor,
          updatedBy: session.user.id,
          updatedAt: new Date(),
        };
        if (r.nickname != null) vals.nickname = r.nickname;
        if (r.nik != null) vals.nik = r.nik;
        if (r.email != null) vals.email = r.email;
        if (r.phone != null) vals.phone = r.phone;
        if (r.address != null) vals.address = r.address;
        if (r.dateOfBirth != null) vals.dateOfBirth = r.dateOfBirth;
        if (r.bankName != null) vals.bankName = r.bankName;
        if (r.bankAccountNumber != null)
          vals.bankAccountNumber = r.bankAccountNumber;
        if (r.bankAccountHolderName != null)
          vals.bankAccountHolderName = r.bankAccountHolderName;
        if (r.dividendBalance != null) {
          vals.dividendBalance = r.dividendBalance;
        }
        if (r.status) {
          vals.status = r.status;
          if (r.status === "exited") vals.exitedAt = new Date();
        }
        upsertTargets.push({
          rowIdx: i + 1,
          existingId: matched.id,
          values: vals,
          oldBalance: matched.dividendBalance,
          newBalance: r.dividendBalance ?? null,
        });
      } else {
        result.skippedDuplicate += 1;
      }
      continue;
    }
    existingByName.set(r.fullName.trim().toLowerCase(), {
      id: "PENDING",
      dividendBalance: 0,
    });
    const vals: typeof pengelola.$inferInsert = {
      outletId: session.user.outletId,
      fullName: r.fullName,
      nickname: r.nickname ?? null,
      nik: r.nik ?? null,
      email: r.email ?? null,
      phone: r.phone ?? null,
      address: r.address ?? null,
      dateOfBirth: r.dateOfBirth ?? null,
      bankName: r.bankName ?? null,
      bankAccountNumber: r.bankAccountNumber ?? null,
      bankAccountHolderName: r.bankAccountHolderName ?? null,
      modalDisetor: r.modalDisetor,
      status: r.status ?? "active",
      createdBy: session.user.id,
      updatedBy: session.user.id,
    };
    if (r.dividendBalance != null) vals.dividendBalance = r.dividendBalance;
    if (r.status === "exited") vals.exitedAt = new Date();
    dedupedRows.push({
      rowIdx: i + 1,
      values: vals,
      seedBalance: r.dividendBalance ?? null,
    });
  }

  /* Apply upserts + capture balance adjustments for capital_movement trail. */
  const balanceAdjustments: Array<{
    pengelolaId: string;
    delta: number;
    newBalance: number;
  }> = [];
  for (const u of upsertTargets) {
    try {
      await db
        .update(pengelola)
        .set(u.values)
        .where(
          and(
            eq(pengelola.id, u.existingId),
            eq(pengelola.outletId, session.user.outletId),
          ),
        );
      result.updated += 1;
      if (u.newBalance != null) {
        const delta = u.newBalance - u.oldBalance;
        if (delta !== 0) {
          balanceAdjustments.push({
            pengelolaId: u.existingId,
            delta,
            newBalance: u.newBalance,
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "DB error";
      result.errors.push({ row: u.rowIdx, reason: `Update gagal: ${msg}` });
    }
  }

  if (balanceAdjustments.length > 0) {
    try {
      await db.insert(capitalMovements).values(
        balanceAdjustments.map((b) => ({
          outletId: session.user.outletId,
          holderType: "pengelola" as const,
          holderId: b.pengelolaId,
          kind: "adjustment" as const,
          amount: b.delta,
          description: `CSV import — saldo dividen di-set ke Rp ${b.newBalance.toLocaleString("id-ID")} (delta ${b.delta >= 0 ? "+" : ""}${b.delta.toLocaleString("id-ID")})`,
          createdBy: session.user.id,
        })),
      );
    } catch (e) {
      console.error("[bulkImportPengelola] capital_movement trail failed:", e);
    }
  }

  if (dedupedRows.length > 0) {
    try {
      const insertedIds = await db
        .insert(pengelola)
        .values(dedupedRows.map((d) => d.values))
        .onConflictDoNothing()
        .returning({ id: pengelola.id, fullName: pengelola.fullName });
      result.inserted = insertedIds.length;
      const racedSkipped = dedupedRows.length - insertedIds.length;
      if (racedSkipped > 0) result.skippedDuplicate += racedSkipped;

      /* Seed capital_movements untuk insert dengan dividendBalance > 0. */
      const seedRows: Array<{ id: string; amount: number }> = [];
      for (const d of dedupedRows) {
        if (d.seedBalance != null && d.seedBalance > 0) {
          const inserted = insertedIds.find(
            (x) => x.fullName === d.values.fullName,
          );
          if (inserted) seedRows.push({ id: inserted.id, amount: d.seedBalance });
        }
      }
      if (seedRows.length > 0) {
        try {
          await db.insert(capitalMovements).values(
            seedRows.map((s) => ({
              outletId: session.user.outletId,
              holderType: "pengelola" as const,
              holderId: s.id,
              kind: "adjustment" as const,
              amount: s.amount,
              description: `CSV import — seed saldo dividen Rp ${s.amount.toLocaleString("id-ID")}`,
              createdBy: session.user.id,
            })),
          );
        } catch (e) {
          console.error("[bulkImportPengelola] seed cm failed:", e);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Batch insert error";
      console.error("[pengelola bulk import batch failed]", msg);
      for (const d of dedupedRows) {
        try {
          await db.insert(pengelola).values(d.values);
          result.inserted += 1;
        } catch (rowErr) {
          const rmsg = rowErr instanceof Error ? rowErr.message : "DB error";
          if (/ux_pengelola_outlet_name/.test(rmsg)) {
            result.skippedDuplicate += 1;
          } else {
            result.errors.push({
              row: d.rowIdx,
              reason: logAndSanitize(rowErr, "pengelola.import", "DB error"),
            });
          }
        }
      }
    }
  }

  logAudit({
    eventType: "pengelola.import",
    userId: session.user.id,
    entityType: "pengelola",
    entityId: null,
    payload: {
      summary: `Import pengelola: ${result.inserted} baru, ${result.updated} di-update, ${result.skippedDuplicate} duplikat, ${result.errors.length} error`,
      context: {
        totalRows: result.totalRows,
        inserted: result.inserted,
        updated: result.updated,
        skippedDuplicate: result.skippedDuplicate,
        errorCount: result.errors.length,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit pengelola.import]", e));

  return ok(result);
}
