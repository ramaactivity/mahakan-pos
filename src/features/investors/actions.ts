"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { investors } from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import {
  bulkImportInvestorsSchema,
  createInvestorSchema,
  listInvestorsSchema,
  updateInvestorSchema,
} from "./schemas";
import {
  fetchInvestorById,
  fetchInvestors,
  fetchTotalModalInvestors,
} from "./queries";
import {
  fail,
  ok,
  type ApiResult,
  type BulkImportInvestorsInput,
  type BulkImportInvestorsResult,
  type CreateInvestorInput,
  type Investor,
  type InvestorWithStats,
  type ListInvestorsOptions,
  type Paginated,
  type UpdateInvestorInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

// ---------- Reads ----------

export async function listInvestors(
  opts: ListInvestorsOptions = {},
): Promise<ApiResult<Paginated<InvestorWithStats>>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "investor.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat investor");
  }
  const parsed = listInvestorsSchema.safeParse(opts);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Filter tidak valid",
    );
  }
  return ok(await fetchInvestors(session.user.outletId, parsed.data));
}

export async function getInvestor(
  id: string,
): Promise<ApiResult<Investor>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "investor.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat investor");
  }
  const row = await fetchInvestorById(session.user.outletId, id);
  if (!row) return fail("NOT_FOUND", "Investor tidak ditemukan");
  return ok(row);
}

export async function getTotalModalInvestors(): Promise<
  ApiResult<{ total: number; count: number }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "investor.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat investor");
  }
  return ok(await fetchTotalModalInvestors(session.user.outletId));
}

// ---------- Mutations ----------

export async function createInvestor(
  input: CreateInvestorInput,
): Promise<ApiResult<Investor>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "investor.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak buat investor");
  }
  const parsed = createInvestorSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  try {
    const [row] = await db
      .insert(investors)
      .values({
        outletId: session.user.outletId,
        fullName: v.fullName,
        nickname: v.nickname,
        nik: v.nik,
        email: v.email,
        phone: v.phone,
        address: v.address,
        dateOfBirth: v.dateOfBirth,
        occupation: v.occupation,
        igHandle: v.igHandle,
        bankName: v.bankName,
        bankAccountNumber: v.bankAccountNumber,
        bankAccountHolderName: v.bankAccountHolderName,
        modalDisetor: v.modalDisetor,
        status: v.status ?? "active",
        notes: v.notes,
        createdBy: session.user.id,
        updatedBy: session.user.id,
      })
      .returning();

    logAudit({
      eventType: "investor.create",
      userId: session.user.id,
      entityType: "investor",
      entityId: row.id,
      payload: {
        summary: `Tambah investor: ${row.fullName} (Rp ${row.modalDisetor.toLocaleString("id-ID")})`,
        context: { modalDisetor: row.modalDisetor, status: row.status },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit investor.create]", e));

    return ok(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "DB error";
    if (/ux_investors_outlet_nik/.test(msg)) {
      return fail("DUPLICATE_NIK", "NIK sudah dipakai investor lain", "nik");
    }
    if (/ux_investors_outlet_email/.test(msg)) {
      return fail(
        "DUPLICATE_EMAIL",
        "Email sudah dipakai investor lain",
        "email",
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "investors.create", "Operasi database gagal"),
    );
  }
}

export async function updateInvestor(
  id: string,
  input: UpdateInvestorInput,
): Promise<ApiResult<Investor>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "investor.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak edit investor");
  }
  const parsed = updateInvestorSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const existing = await fetchInvestorById(session.user.outletId, id);
  if (!existing) return fail("NOT_FOUND", "Investor tidak ditemukan");

  const v = parsed.data;
  /* Exit semantics: kalau status='exited' & exitedAt belum di-set,
   * server stamp current time. */
  const exitedAt =
    v.status === "exited" && !existing.exitedAt
      ? new Date()
      : v.status && v.status !== "exited"
        ? null
        : existing.exitedAt;

  try {
    const [row] = await db
      .update(investors)
      .set({
        ...v,
        exitedAt,
        updatedAt: new Date(),
        updatedBy: session.user.id,
      })
      /* Sesi AE-63 audit P0 — outlet-scope di WHERE clause (defense-in-depth).
       * Pre-check fetchInvestorById sudah validate, tapi mutation WAJIB
       * ulang verify supaya race condition / pre-check bypass aman. */
      .where(
        and(
          eq(investors.id, id),
          eq(investors.outletId, session.user.outletId),
        ),
      )
      .returning();

    if (!row) {
      return fail("NOT_FOUND", "Investor tidak ditemukan / outlet mismatch");
    }

    logAudit({
      eventType: "investor.update",
      userId: session.user.id,
      entityType: "investor",
      entityId: id,
      payload: {
        summary: `Update investor: ${row.fullName}`,
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
    }).catch((e) => console.error("[audit investor.update]", e));

    return ok(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "DB error";
    if (/ux_investors_outlet_nik/.test(msg)) {
      return fail("DUPLICATE_NIK", "NIK sudah dipakai investor lain", "nik");
    }
    if (/ux_investors_outlet_email/.test(msg)) {
      return fail(
        "DUPLICATE_EMAIL",
        "Email sudah dipakai investor lain",
        "email",
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "investors.update", "Operasi database gagal"),
    );
  }
}

export async function deleteInvestor(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "investor.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak hapus investor");
  }
  const existing = await fetchInvestorById(session.user.outletId, id);
  if (!existing) return fail("NOT_FOUND", "Investor tidak ditemukan");

  /* Soft-delete supaya history dividen tetap consistent.
   * Sesi AE-63 audit P0 — outlet-scope di WHERE. */
  await db
    .update(investors)
    .set({ deletedAt: new Date(), updatedBy: session.user.id })
    .where(
      and(
        eq(investors.id, id),
        eq(investors.outletId, session.user.outletId),
      ),
    );

  logAudit({
    eventType: "investor.delete",
    userId: session.user.id,
    entityType: "investor",
    entityId: id,
    payload: { summary: `Hapus investor: ${existing.fullName}` },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit investor.delete]", e));

  return ok({ id });
}

// ---------- Bulk Import ----------

/**
 * Bulk insert investors dari CSV (max 500 row per call). Idempotent
 * via dedup pada (outletId, fullName) untuk row tanpa NIK, atau
 * (outletId, NIK) untuk row dengan NIK. Duplicates dilewati, dihitung
 * di hasil response.
 *
 * Untuk Mahakan migration dari Sheets: 110 investor row.
 */
export async function bulkImportInvestors(
  input: BulkImportInvestorsInput,
): Promise<ApiResult<BulkImportInvestorsResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "investor.import")) {
    return fail("FORBIDDEN", "Tidak punya hak import investor");
  }
  const parsed = bulkImportInvestorsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const { rows } = parsed.data;

  /* Pre-fetch existing untuk dedup di app-side (no FK conflicts).
   * Pakai partial unique index sebagai final guard kalau ada race. */
  const existing = await db
    .select({
      id: investors.id,
      fullName: investors.fullName,
      nik: investors.nik,
    })
    .from(investors)
    .where(
      and(
        eq(investors.outletId, session.user.outletId),
        isNull(investors.deletedAt),
      ),
    );
  const existingByNik = new Set(
    existing.filter((r) => r.nik).map((r) => r.nik as string),
  );
  const existingByName = new Set(
    existing.map((r) => r.fullName.trim().toLowerCase()),
  );

  const result: BulkImportInvestorsResult = {
    totalRows: rows.length,
    inserted: 0,
    skippedDuplicate: 0,
    errors: [],
  };

  /* Sesi AE-63 audit P1.5 — batch insert. Pre-fix: 1 INSERT per row =
   * 500 round-trips ke DB (jaringan Vercel↔Neon Singapore). Sekarang:
   * 1. Filter dup di app-side (dari pre-fetch existing set).
   * 2. INSERT batch all non-dup rows dengan onConflictDoNothing.
   * 3. Kalau ada row yang silently skipped (race with unique index), retry
   *    per row individu untuk capture error message yang jelas. */
  const dedupedRows: Array<{
    rowIdx: number;
    values: typeof investors.$inferInsert;
  }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const isDup =
      (r.nik && existingByNik.has(r.nik)) ||
      existingByName.has(r.fullName.trim().toLowerCase());
    if (isDup) {
      result.skippedDuplicate += 1;
      continue;
    }
    /* Track di seen-sets supaya kalau import file punya dup internally
     * (mis. 2 row dengan NIK sama), row ke-2 di-skip. */
    if (r.nik) existingByNik.add(r.nik);
    existingByName.add(r.fullName.trim().toLowerCase());
    dedupedRows.push({
      rowIdx: i + 1,
      values: {
        outletId: session.user.outletId,
        fullName: r.fullName,
        nik: r.nik ?? null,
        email: r.email ?? null,
        phone: r.phone ?? null,
        address: r.address ?? null,
        dateOfBirth: r.dateOfBirth ?? null,
        occupation: r.occupation ?? null,
        igHandle: r.igHandle ?? null,
        bankName: r.bankName ?? null,
        bankAccountNumber: r.bankAccountNumber ?? null,
        bankAccountHolderName: r.bankAccountHolderName ?? null,
        modalDisetor: r.modalDisetor,
        status: "active",
        createdBy: session.user.id,
        updatedBy: session.user.id,
      },
    });
  }

  if (dedupedRows.length > 0) {
    try {
      /* Single batch INSERT — drastically faster than per-row loop.
       * onConflictDoNothing handles race kalau ada concurrent import,
       * partial unique index ux_investors_outlet_nik mengkacau. */
      const insertedIds = await db
        .insert(investors)
        .values(dedupedRows.map((d) => d.values))
        .onConflictDoNothing()
        .returning({ id: investors.id });
      result.inserted = insertedIds.length;
      /* Beda antara dedupedRows.length dan insertedIds.length = race-conflict
       * baris (insert skipped diam-diam oleh onConflictDoNothing). Hitung
       * sebagai duplikat — owner sudah tahu Mahakan duplikat tidak di-insert. */
      const racedSkipped = dedupedRows.length - insertedIds.length;
      if (racedSkipped > 0) result.skippedDuplicate += racedSkipped;
    } catch (e) {
      /* Batch fail (rare — e.g., schema mismatch). Fallback ke per-row
       * loop supaya partial import + error detail jelas. */
      const msg = e instanceof Error ? e.message : "Batch insert error";
      console.error("[investor bulk import batch failed, falling back]", msg);
      for (const d of dedupedRows) {
        try {
          await db.insert(investors).values(d.values);
          result.inserted += 1;
        } catch (rowErr) {
          const rmsg =
            rowErr instanceof Error ? rowErr.message : "DB error";
          if (/ux_investors_outlet_nik|ux_investors_outlet_email/.test(rmsg)) {
            result.skippedDuplicate += 1;
          } else {
            result.errors.push({
              row: d.rowIdx,
              reason: logAndSanitize(rowErr, "investors.import", "DB error"),
            });
          }
        }
      }
    }
  }

  logAudit({
    eventType: "investor.import",
    userId: session.user.id,
    entityType: "investor",
    entityId: null,
    payload: {
      summary: `Import investor: ${result.inserted} baru, ${result.skippedDuplicate} duplikat dilewati, ${result.errors.length} error`,
      context: {
        totalRows: result.totalRows,
        inserted: result.inserted,
        skippedDuplicate: result.skippedDuplicate,
        errorCount: result.errors.length,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit investor.import]", e));

  return ok(result);
}
