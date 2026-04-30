"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  inventoryMovements,
  stockOpnameLines,
  stockOpnameSessions,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { jakartaMonthLabel } from "./cadence";
import { computeDiffStats } from "./diff-stats";
import {
  cancelOpnameSchema,
  finalizeOpnameSchema,
  reopenOpnameSchema,
  saveCountBatchSchema,
  saveCountSchema,
  startOpnameSchema,
  submitOpnameSchema,
} from "./schemas";
import {
  fetchActiveIngredientsForSnapshot,
  fetchActiveSession,
  fetchMonthlyCadenceStatus,
  fetchSessionDetail,
  fetchSessions,
} from "./queries";
import {
  fail,
  ok,
  type ApiResult,
  type CancelOpnameInput,
  type FinalizeOpnameInput,
  type MonthlyCadenceStatus,
  type OpnameSession,
  type OpnameSessionDetail,
  type OpnameSessionWithCounts,
  type ReopenOpnameInput,
  type SaveCountBatchInput,
  type SaveCountInput,
  type StartOpnameInput,
  type SubmitOpnameInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

// ============================================================================
// Reads
// ============================================================================

export async function listOpnameSessions(opts: {
  limit?: number;
} = {}): Promise<ApiResult<OpnameSessionWithCounts[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.opname.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat opname");
  }
  return ok(await fetchSessions(session.user.outletId, opts));
}

export async function getActiveOpname(): Promise<
  ApiResult<OpnameSession | null>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.opname.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat opname");
  }
  return ok(await fetchActiveSession(session.user.outletId));
}

export async function getMonthlyCadence(): Promise<
  ApiResult<MonthlyCadenceStatus>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.opname.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat opname");
  }
  return ok(
    await fetchMonthlyCadenceStatus(session.user.outletId, new Date()),
  );
}

export async function getOpnameDetail(
  sessionId: string,
): Promise<ApiResult<OpnameSessionDetail | null>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.opname.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat opname");
  }
  return ok(await fetchSessionDetail(sessionId, session.user.outletId));
}

// ============================================================================
// Mutations
// ============================================================================

export async function startOpname(
  input: StartOpnameInput = {},
): Promise<ApiResult<OpnameSessionDetail>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.opname.start")) {
    return fail("FORBIDDEN", "Tidak punya hak mulai opname");
  }

  const parsed = startOpnameSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;
  const periodLabel = v.periodLabel ?? jakartaMonthLabel(new Date());

  // Block double-start — DB partial-unique index also enforces this, but
  // we want a friendly error before the constraint fires.
  const existingActive = await fetchActiveSession(session.user.outletId);
  if (existingActive) {
    return fail(
      "CONFLICT",
      `Masih ada opname aktif (${existingActive.periodLabel}, ${existingActive.status === "in_progress" ? "berjalan" : "menunggu review"}). Selesaikan atau cancel dulu.`,
    );
  }

  const ingredientsToSnapshot = await fetchActiveIngredientsForSnapshot(
    session.user.outletId,
  );
  if (ingredientsToSnapshot.length === 0) {
    return fail(
      "VALIDATION_ERROR",
      "Tidak ada bahan aktif untuk di-opname. Tambah bahan dulu di tab Bahan.",
    );
  }

  let createdSession: OpnameSession;
  try {
    createdSession = await db.transaction(async (tx) => {
      const [s] = await tx
        .insert(stockOpnameSessions)
        .values({
          outletId: session.user.outletId,
          status: "in_progress",
          periodLabel,
          notes: v.notes ?? null,
          startedBy: session.user.id,
          totalLines: ingredientsToSnapshot.length,
        })
        .returning();
      if (!s) throw new Error("CREATE_FAILED");

      await tx.insert(stockOpnameLines).values(
        ingredientsToSnapshot.map((ing) => ({
          sessionId: s.id,
          ingredientId: ing.id,
          expectedQty: ing.currentStock,
          unitCostAtSnapshot: ing.costPerUnit,
          ingredientNameSnapshot: ing.name,
          unitSnapshot: ing.unit,
        })),
      );

      return s;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg.includes("ux_opname_sessions_active_per_outlet")) {
      return fail(
        "CONFLICT",
        "Sesi opname aktif sudah ada — refresh dan coba lagi.",
      );
    }
    return fail("DB_ERROR", msg);
  }

  await logAudit({
    eventType: "inventory.opname.start",
    userId: session.user.id,
    entityType: "stock_opname_session",
    entityId: createdSession.id,
    payload: {
      summary: `Mulai opname ${periodLabel} (${ingredientsToSnapshot.length} bahan)`,
      context: {
        periodLabel,
        totalLines: ingredientsToSnapshot.length,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  const detail = await fetchSessionDetail(
    createdSession.id,
    session.user.outletId,
  );
  if (!detail) return fail("DB_ERROR", "Gagal load sesi setelah dibuat");
  return ok(detail);
}

export async function saveOpnameCount(
  input: SaveCountInput,
): Promise<ApiResult<{ countedLines: number; totalLines: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.opname.count")) {
    return fail("FORBIDDEN", "Tidak punya hak input opname");
  }
  const parsed = saveCountSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  try {
    return ok(
      await db.transaction(async (tx) => {
        const [sess] = await tx
          .select()
          .from(stockOpnameSessions)
          .where(
            and(
              eq(stockOpnameSessions.id, v.sessionId),
              eq(stockOpnameSessions.outletId, session.user.outletId),
            ),
          )
          .for("update")
          .limit(1);
        if (!sess) throw new Error("NOT_FOUND");
        if (sess.status !== "in_progress") {
          throw new Error("BAD_STATE");
        }

        const setClause: Record<string, unknown> = {
          actualQty: v.actualQty,
          note: v.note ?? null,
        };
        if (v.actualQty === null) {
          setClause.countedAt = null;
          setClause.countedBy = null;
        } else {
          setClause.countedAt = new Date();
          setClause.countedBy = session.user.id;
        }

        const [updated] = await tx
          .update(stockOpnameLines)
          .set(setClause)
          .where(
            and(
              eq(stockOpnameLines.sessionId, v.sessionId),
              eq(stockOpnameLines.ingredientId, v.ingredientId),
            ),
          )
          .returning({ id: stockOpnameLines.id });
        if (!updated) throw new Error("LINE_NOT_FOUND");

        const [stats] = await tx
          .select({
            counted: sql<number>`count(*) FILTER (WHERE ${stockOpnameLines.actualQty} IS NOT NULL)::int`,
            total: sql<number>`count(*)::int`,
          })
          .from(stockOpnameLines)
          .where(eq(stockOpnameLines.sessionId, v.sessionId));

        await tx
          .update(stockOpnameSessions)
          .set({
            countedLines: stats?.counted ?? 0,
            updatedAt: new Date(),
          })
          .where(eq(stockOpnameSessions.id, v.sessionId));

        return {
          countedLines: stats?.counted ?? 0,
          totalLines: stats?.total ?? 0,
        };
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "NOT_FOUND") return fail("NOT_FOUND", "Sesi tidak ditemukan");
    if (msg === "BAD_STATE")
      return fail(
        "BAD_STATE",
        "Sesi sudah disubmit / selesai — tidak bisa edit count.",
      );
    if (msg === "LINE_NOT_FOUND")
      return fail("NOT_FOUND", "Bahan tidak ada di sesi ini");
    return fail("DB_ERROR", msg);
  }
}

export async function saveOpnameCountBatch(
  input: SaveCountBatchInput,
): Promise<ApiResult<{ countedLines: number; totalLines: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.opname.count")) {
    return fail("FORBIDDEN", "Tidak punya hak input opname");
  }
  const parsed = saveCountBatchSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;
  // Dedupe — ingredientId must be unique per batch.
  const seen = new Set<string>();
  for (const l of v.lines) {
    if (seen.has(l.ingredientId))
      return fail("VALIDATION_ERROR", "Bahan duplikat dalam batch");
    seen.add(l.ingredientId);
  }

  try {
    return ok(
      await db.transaction(async (tx) => {
        const [sess] = await tx
          .select()
          .from(stockOpnameSessions)
          .where(
            and(
              eq(stockOpnameSessions.id, v.sessionId),
              eq(stockOpnameSessions.outletId, session.user.outletId),
            ),
          )
          .for("update")
          .limit(1);
        if (!sess) throw new Error("NOT_FOUND");
        if (sess.status !== "in_progress") throw new Error("BAD_STATE");

        const now = new Date();
        for (const line of v.lines) {
          const setClause: Record<string, unknown> = {
            actualQty: line.actualQty,
            note: line.note ?? null,
          };
          if (line.actualQty === null) {
            setClause.countedAt = null;
            setClause.countedBy = null;
          } else {
            setClause.countedAt = now;
            setClause.countedBy = session.user.id;
          }
          await tx
            .update(stockOpnameLines)
            .set(setClause)
            .where(
              and(
                eq(stockOpnameLines.sessionId, v.sessionId),
                eq(stockOpnameLines.ingredientId, line.ingredientId),
              ),
            );
        }

        const [stats] = await tx
          .select({
            counted: sql<number>`count(*) FILTER (WHERE ${stockOpnameLines.actualQty} IS NOT NULL)::int`,
            total: sql<number>`count(*)::int`,
          })
          .from(stockOpnameLines)
          .where(eq(stockOpnameLines.sessionId, v.sessionId));

        await tx
          .update(stockOpnameSessions)
          .set({
            countedLines: stats?.counted ?? 0,
            updatedAt: now,
          })
          .where(eq(stockOpnameSessions.id, v.sessionId));

        return {
          countedLines: stats?.counted ?? 0,
          totalLines: stats?.total ?? 0,
        };
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "NOT_FOUND") return fail("NOT_FOUND", "Sesi tidak ditemukan");
    if (msg === "BAD_STATE")
      return fail(
        "BAD_STATE",
        "Sesi sudah disubmit / selesai — tidak bisa edit count.",
      );
    return fail("DB_ERROR", msg);
  }
}

export async function submitOpname(
  input: SubmitOpnameInput,
): Promise<ApiResult<{ sessionId: string; pendingReview: true }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.opname.count")) {
    return fail("FORBIDDEN", "Tidak punya hak submit opname");
  }
  const parsed = submitOpnameSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  try {
    return ok(
      await db.transaction(async (tx) => {
        const [sess] = await tx
          .select()
          .from(stockOpnameSessions)
          .where(
            and(
              eq(stockOpnameSessions.id, v.sessionId),
              eq(stockOpnameSessions.outletId, session.user.outletId),
            ),
          )
          .for("update")
          .limit(1);
        if (!sess) throw new Error("NOT_FOUND");
        if (sess.status !== "in_progress") throw new Error("BAD_STATE");

        const linesRows = await tx
          .select({
            id: stockOpnameLines.id,
            expectedQty: stockOpnameLines.expectedQty,
            actualQty: stockOpnameLines.actualQty,
            unitCostAtSnapshot: stockOpnameLines.unitCostAtSnapshot,
          })
          .from(stockOpnameLines)
          .where(eq(stockOpnameLines.sessionId, v.sessionId));

        const uncountedIds = linesRows
          .filter((l) => l.actualQty === null)
          .map((l) => l.id);

        if (uncountedIds.length > 0) {
          if (!v.treatUncountedAsExpected) {
            throw new Error(
              `UNCOUNTED:${uncountedIds.length}`,
            );
          }
          // Auto-fill uncounted lines with expected qty (zero diff). They're
          // recorded as counted by submitter so audit trail is preserved.
          await tx
            .update(stockOpnameLines)
            .set({
              actualQty: sql`${stockOpnameLines.expectedQty}`,
              countedAt: new Date(),
              countedBy: session.user.id,
              note: sql`COALESCE(${stockOpnameLines.note}, 'Auto-fill saat submit (sesuai expected)')`,
            })
            .where(
              and(
                eq(stockOpnameLines.sessionId, v.sessionId),
                inArray(stockOpnameLines.id, uncountedIds),
              ),
            );
        }

        const finalLines = await tx
          .select({
            expectedQty: stockOpnameLines.expectedQty,
            actualQty: stockOpnameLines.actualQty,
            unitCostAtSnapshot: stockOpnameLines.unitCostAtSnapshot,
          })
          .from(stockOpnameLines)
          .where(eq(stockOpnameLines.sessionId, v.sessionId));

        const stats = computeDiffStats(finalLines);

        await tx
          .update(stockOpnameSessions)
          .set({
            status: "pending_review",
            submittedAt: new Date(),
            submittedBy: session.user.id,
            countedLines: stats.countedLines,
            totalDiffQty: stats.totalAbsDiffQty,
            totalDiffCost: stats.totalAbsDiffCost,
            updatedAt: new Date(),
          })
          .where(eq(stockOpnameSessions.id, v.sessionId));

        return { sessionId: v.sessionId, pendingReview: true as const };
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "NOT_FOUND") return fail("NOT_FOUND", "Sesi tidak ditemukan");
    if (msg === "BAD_STATE")
      return fail(
        "BAD_STATE",
        "Sesi sudah disubmit atau selesai.",
      );
    if (msg.startsWith("UNCOUNTED:")) {
      const n = msg.slice("UNCOUNTED:".length);
      return fail(
        "UNCOUNTED",
        `Masih ada ${n} bahan belum dihitung. Lengkapi atau pilih opsi auto-fill.`,
      );
    }
    return fail("DB_ERROR", msg);
  } finally {
    // Audit outside the txn so we don't roll back the session move on log fail.
    if (true) {
      await logAudit({
        eventType: "inventory.opname.submit",
        userId: session.user.id,
        entityType: "stock_opname_session",
        entityId: v.sessionId,
        payload: {
          summary: `Submit opname untuk review`,
        },
        metadata: {
          outletId: session.user.outletId,
          actorRole: session.user.role,
        },
      });
    }
  }
}

export async function finalizeOpname(
  input: FinalizeOpnameInput,
): Promise<
  ApiResult<{
    sessionId: string;
    movementsCreated: number;
    totalAbsDiffQty: number;
    totalAbsDiffCost: number;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.opname.finalize")) {
    return fail(
      "FORBIDDEN",
      "Hanya manager / owner yang boleh finalize opname",
    );
  }
  const parsed = finalizeOpnameSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  let result: {
    movementsCreated: number;
    totalAbsDiffQty: number;
    totalAbsDiffCost: number;
  };
  try {
    result = await db.transaction(async (tx) => {
      const [sess] = await tx
        .select()
        .from(stockOpnameSessions)
        .where(
          and(
            eq(stockOpnameSessions.id, v.sessionId),
            eq(stockOpnameSessions.outletId, session.user.outletId),
          ),
        )
        .for("update")
        .limit(1);
      if (!sess) throw new Error("NOT_FOUND");
      if (sess.status !== "pending_review") throw new Error("BAD_STATE");

      const lines = await tx
        .select({
          id: stockOpnameLines.id,
          ingredientId: stockOpnameLines.ingredientId,
          expectedQty: stockOpnameLines.expectedQty,
          actualQty: stockOpnameLines.actualQty,
          unitCostAtSnapshot: stockOpnameLines.unitCostAtSnapshot,
          ingredientNameSnapshot: stockOpnameLines.ingredientNameSnapshot,
        })
        .from(stockOpnameLines)
        .where(eq(stockOpnameLines.sessionId, v.sessionId));

      let movementsCreated = 0;
      let totalAbsDiffQty = 0;
      let totalAbsDiffCost = 0;

      // Lock all impacted ingredients up front for atomicity.
      const impactedIds = lines
        .filter(
          (l) =>
            l.actualQty !== null && l.actualQty - l.expectedQty !== 0,
        )
        .map((l) => l.ingredientId);

      if (impactedIds.length > 0) {
        const liveIngs = await tx
          .select({
            id: ingredients.id,
            outletId: ingredients.outletId,
            currentStock: ingredients.currentStock,
            deletedAt: ingredients.deletedAt,
          })
          .from(ingredients)
          .where(inArray(ingredients.id, impactedIds))
          .for("update");

        const liveById = new Map(liveIngs.map((r) => [r.id, r] as const));

        for (const line of lines) {
          if (line.actualQty === null) continue;
          const diff = line.actualQty - line.expectedQty;
          if (diff === 0) continue;

          const live = liveById.get(line.ingredientId);
          if (!live || live.deletedAt !== null) {
            // Skip lines whose ingredient was soft-deleted between snapshot
            // and finalize — finalize-time cost impact is still reported but
            // no movement is created (movement_id stays null).
            continue;
          }
          if (live.outletId !== session.user.outletId) {
            throw new Error("OUTLET_MISMATCH");
          }

          const newStock = live.currentStock + diff;
          if (newStock < 0) {
            throw new Error(
              `NEGATIVE_STOCK:${line.ingredientNameSnapshot}`,
            );
          }

          await tx
            .update(ingredients)
            .set({
              currentStock: newStock,
              updatedAt: new Date(),
              updatedBy: session.user.id,
            })
            .where(eq(ingredients.id, line.ingredientId));
          live.currentStock = newStock;

          const [movement] = await tx
            .insert(inventoryMovements)
            .values({
              outletId: session.user.outletId,
              ingredientId: line.ingredientId,
              kind: "adjust",
              qtyDelta: diff,
              unitCostAtMovement: line.unitCostAtSnapshot,
              referenceType: "manual",
              referenceId: v.sessionId,
              reason: `Opname ${sess.periodLabel} — selisih ${diff > 0 ? "+" : ""}${diff}`,
              createdBy: session.user.id,
            })
            .returning({ id: inventoryMovements.id });

          await tx
            .update(stockOpnameLines)
            .set({ movementId: movement.id })
            .where(eq(stockOpnameLines.id, line.id));

          movementsCreated++;
          totalAbsDiffQty += Math.abs(diff);
          totalAbsDiffCost += Math.abs(diff) * line.unitCostAtSnapshot;
        }
      }

      await tx
        .update(stockOpnameSessions)
        .set({
          status: "completed",
          finalizedAt: new Date(),
          finalizedBy: session.user.id,
          totalDiffQty: totalAbsDiffQty,
          totalDiffCost: totalAbsDiffCost,
          updatedAt: new Date(),
        })
        .where(eq(stockOpnameSessions.id, v.sessionId));

      return {
        movementsCreated,
        totalAbsDiffQty,
        totalAbsDiffCost,
      };
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "NOT_FOUND") return fail("NOT_FOUND", "Sesi tidak ditemukan");
    if (msg === "BAD_STATE")
      return fail(
        "BAD_STATE",
        "Sesi tidak dalam status pending_review.",
      );
    if (msg === "OUTLET_MISMATCH")
      return fail("DB_ERROR", "Bahan dari outlet lain — kontak admin.");
    if (msg.startsWith("NEGATIVE_STOCK:")) {
      const name = msg.slice("NEGATIVE_STOCK:".length);
      return fail(
        "VALIDATION_ERROR",
        `Finalize akan bikin stok ${name} negatif. Cek input count.`,
      );
    }
    return fail("DB_ERROR", msg);
  }

  await logAudit({
    eventType: "inventory.opname.finalize",
    userId: session.user.id,
    entityType: "stock_opname_session",
    entityId: v.sessionId,
    payload: {
      summary: `Finalize opname — ${result.movementsCreated} adjust dibuat (Δqty ${result.totalAbsDiffQty}, Δcost ${result.totalAbsDiffCost})`,
      context: {
        movementsCreated: result.movementsCreated,
        totalAbsDiffQty: result.totalAbsDiffQty,
        totalAbsDiffCost: result.totalAbsDiffCost,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  return ok({
    sessionId: v.sessionId,
    ...result,
  });
}

export async function cancelOpname(
  input: CancelOpnameInput,
): Promise<ApiResult<{ sessionId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.opname.cancel")) {
    return fail(
      "FORBIDDEN",
      "Hanya manager / owner yang boleh cancel opname",
    );
  }
  const parsed = cancelOpnameSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [sess] = await tx
        .select()
        .from(stockOpnameSessions)
        .where(
          and(
            eq(stockOpnameSessions.id, v.sessionId),
            eq(stockOpnameSessions.outletId, session.user.outletId),
          ),
        )
        .for("update")
        .limit(1);
      if (!sess) throw new Error("NOT_FOUND");
      if (sess.status === "completed" || sess.status === "cancelled") {
        throw new Error("BAD_STATE");
      }
      await tx
        .update(stockOpnameSessions)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledBy: session.user.id,
          cancelReason: v.reason,
          updatedAt: new Date(),
        })
        .where(eq(stockOpnameSessions.id, v.sessionId));
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "NOT_FOUND") return fail("NOT_FOUND", "Sesi tidak ditemukan");
    if (msg === "BAD_STATE")
      return fail(
        "BAD_STATE",
        "Sesi sudah completed / cancelled, tidak bisa di-cancel.",
      );
    return fail("DB_ERROR", msg);
  }

  await logAudit({
    eventType: "inventory.opname.cancel",
    userId: session.user.id,
    entityType: "stock_opname_session",
    entityId: v.sessionId,
    payload: {
      summary: `Cancel opname — ${v.reason}`,
      context: { reason: v.reason },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  return ok({ sessionId: v.sessionId });
}

export async function reopenOpname(
  input: ReopenOpnameInput,
): Promise<ApiResult<{ sessionId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.opname.finalize")) {
    return fail(
      "FORBIDDEN",
      "Hanya manager / owner yang boleh reopen opname",
    );
  }
  const parsed = reopenOpnameSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [sess] = await tx
        .select()
        .from(stockOpnameSessions)
        .where(
          and(
            eq(stockOpnameSessions.id, v.sessionId),
            eq(stockOpnameSessions.outletId, session.user.outletId),
          ),
        )
        .for("update")
        .limit(1);
      if (!sess) throw new Error("NOT_FOUND");
      if (sess.status !== "pending_review") throw new Error("BAD_STATE");
      await tx
        .update(stockOpnameSessions)
        .set({
          status: "in_progress",
          submittedAt: null,
          submittedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(stockOpnameSessions.id, v.sessionId));
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "NOT_FOUND") return fail("NOT_FOUND", "Sesi tidak ditemukan");
    if (msg === "BAD_STATE")
      return fail("BAD_STATE", "Sesi tidak dalam status pending_review.");
    return fail("DB_ERROR", msg);
  }

  return ok({ sessionId: v.sessionId });
}
