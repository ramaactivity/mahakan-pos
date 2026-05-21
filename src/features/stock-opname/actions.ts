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
import { logAndSanitize } from "@/lib/server-error";
import { computeNewStock, formatMovementDelta } from "@/lib/stock-decimal";
import { jakartaMonthLabel } from "./cadence";
import { computeDiffStats } from "./diff-stats";
import {
  addOpnameItemAdHocSchema,
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
  fetchOpnameInventoryFlow,
  type OpnameInventoryFlow,
} from "./inventory-flow";
import {
  fail,
  ok,
  type AddOpnameItemAdHocInput,
  type ApiResult,
  type CancelOpnameInput,
  type FinalizeOpnameInput,
  type MonthlyCadenceStatus,
  type OpnameLineWithIngredient,
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

/**
 * Per-line inventory flow for the active opname — Stok Awal +
 * Pembelian + (window metadata) per ingredient. Surface ke
 * OpnameCountView untuk show formula HPP real-time saat staff
 * mengetik (sesi AA #1 enhancement). Map serialized as plain object
 * for the server-action boundary; client rebuilds Map.
 */
export interface OpnameInventoryFlowSerialized {
  perIngredient: Record<
    string,
    {
      openingQty: number;
      openingUnitCost: number;
      purchasesQty: number;
      purchasesCost: number;
    }
  >;
  hasPriorOpname: boolean;
  priorOpnameDate: string | null;
  windowFrom: string;
  windowTo: string;
}

function serializeFlow(
  flow: OpnameInventoryFlow,
): OpnameInventoryFlowSerialized {
  const perIngredient: OpnameInventoryFlowSerialized["perIngredient"] = {};
  for (const [k, v] of flow.perIngredient) perIngredient[k] = v;
  return {
    perIngredient,
    hasPriorOpname: flow.hasPriorOpname,
    priorOpnameDate: flow.priorOpnameDate,
    windowFrom: flow.windowFrom,
    windowTo: flow.windowTo,
  };
}

export async function getOpnameInventoryFlow(
  sessionId: string,
): Promise<ApiResult<OpnameInventoryFlowSerialized | null>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.opname.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat opname");
  }
  const flow = await fetchOpnameInventoryFlow(
    session.user.outletId,
    sessionId,
  );
  return ok(flow ? serializeFlow(flow) : null);
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
          // Sesi AE-62e — clamp bigint ke 0 untuk pass ck_opname_lines_expected_nonneg.
          // Stok bisa negatif kalau ada oversold (sale_deduct tanpa cukup stok)
          // — common di prod. Real value tetap disimpan di decimal mirror
          // (no check constraint) → finalize compute diff pakai decimal,
          // so adjust movement masih bring stock ke physical reality.
          expectedQty: Math.max(0, ing.currentStock),
          expectedQtyDecimal:
            ing.currentStockDecimal ?? Number(ing.currentStock).toFixed(4),
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
    return fail("DB_ERROR", logAndSanitize(e, "stock-opname", "Operasi database gagal"));
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

        // Sesi AE-15 — write decimal mirror. bigint = rounded snapshot.
        const setClause: Record<string, unknown> = {
          actualQty:
            v.actualQty === null ? null : Math.max(0, Math.round(v.actualQty)),
          actualQtyDecimal:
            v.actualQty === null ? null : v.actualQty.toFixed(4),
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
    return fail("DB_ERROR", logAndSanitize(e, "stock-opname", "Operasi database gagal"));
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
          // Sesi AE-15 — decimal mirror.
          const setClause: Record<string, unknown> = {
            actualQty:
              line.actualQty === null
                ? null
                : Math.max(0, Math.round(line.actualQty)),
            actualQtyDecimal:
              line.actualQty === null ? null : line.actualQty.toFixed(4),
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
    return fail("DB_ERROR", logAndSanitize(e, "stock-opname", "Operasi database gagal"));
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
            expectedQtyDecimal: stockOpnameLines.expectedQtyDecimal,
            actualQty: stockOpnameLines.actualQty,
            actualQtyDecimal: stockOpnameLines.actualQtyDecimal,
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
          // Sesi AE-62e — mirror decimal juga supaya finalize compute
          // diff = 0 (no movement) untuk uncounted-auto-fill case, even
          // kalau real expected (decimal) negative dari oversold.
          // Sesi AE-62g — kalau expectedQtyDecimal NULL (legacy row),
          // fallback ke expectedQty::numeric supaya diff hitung pakai
          // bigint value (tidak loss decimal information yang ada).
          await tx
            .update(stockOpnameLines)
            .set({
              actualQty: sql`${stockOpnameLines.expectedQty}`,
              actualQtyDecimal: sql`COALESCE(${stockOpnameLines.expectedQtyDecimal}, ${stockOpnameLines.expectedQty}::numeric)`,
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
            expectedQtyDecimal: stockOpnameLines.expectedQtyDecimal,
            actualQty: stockOpnameLines.actualQty,
            actualQtyDecimal: stockOpnameLines.actualQtyDecimal,
            unitCostAtSnapshot: stockOpnameLines.unitCostAtSnapshot,
          })
          .from(stockOpnameLines)
          .where(eq(stockOpnameLines.sessionId, v.sessionId));

        const stats = computeDiffStats(finalLines);

        /* Sesi AE-63 phase5 — P0 BUG FIX: totalDiffQty/totalDiffCost adalah
         * bigint column tapi computeDiffStats accumulate float (decimal qty ×
         * bigint cost). 127 lines × non-integer diff → accumulated float not
         * safely convert ke bigint → Postgres "invalid input syntax for type
         * bigint" → submit gagal dengan "Operasi database gagal".
         *
         * Fix: Math.round di boundary write. UI tetap dapat float dari
         * computeDiffStats untuk display precision; DB hanya simpan integer
         * rollup snapshot (display ulang dari lines kalau butuh exact). */
        await tx
          .update(stockOpnameSessions)
          .set({
            status: "pending_review",
            submittedAt: new Date(),
            submittedBy: session.user.id,
            countedLines: stats.countedLines,
            totalDiffQty: Math.round(stats.totalAbsDiffQty),
            totalDiffCost: Math.round(stats.totalAbsDiffCost),
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
    return fail("DB_ERROR", logAndSanitize(e, "stock-opname", "Operasi database gagal"));
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
          expectedQtyDecimal: stockOpnameLines.expectedQtyDecimal,
          actualQty: stockOpnameLines.actualQty,
          actualQtyDecimal: stockOpnameLines.actualQtyDecimal,
          unitCostAtSnapshot: stockOpnameLines.unitCostAtSnapshot,
          ingredientNameSnapshot: stockOpnameLines.ingredientNameSnapshot,
        })
        .from(stockOpnameLines)
        .where(eq(stockOpnameLines.sessionId, v.sessionId));

      let movementsCreated = 0;
      let totalAbsDiffQty = 0;
      let totalAbsDiffCost = 0;

      // Sesi AE-15 — diff dihitung pakai decimal kalau ada (precise),
      // fallback bigint untuk legacy lines pre-AE-15.
      //
      // Sesi AE-63 phase7 — defensive parseFloat: kalau decimal corrupt,
      // fallback bigint + finite-guard. Tanpa ini, NaN propagate ke diff
      // → NaN movement delta → DB cast fail.
      const safeParseDec = (s: string | null, fb: number): number => {
        if (s === null) return Number.isFinite(fb) ? fb : 0;
        const p = parseFloat(s);
        return Number.isFinite(p) ? p : Number.isFinite(fb) ? fb : 0;
      };
      const computeDiff = (l: (typeof lines)[number]): number => {
        if (l.actualQty === null) return 0;
        const expected = safeParseDec(l.expectedQtyDecimal, l.expectedQty);
        const actual = safeParseDec(l.actualQtyDecimal, l.actualQty);
        const d = actual - expected;
        return Number.isFinite(d) ? d : 0;
      };

      /* Sesi AE-81 — Replace-semantic fix for stale-snapshot bug.
       *
       * OLD bug: kode dulu apply `actual - expected_snapshot` (snapshot diff)
       * ke `currentStock_NOW`. Tapi snapshot di-freeze saat session start,
       * sementara POS sales / purchases bisa mutate currentStock di antara
       * snapshot dan finalize. Hasilnya: kalau snapshot 700, sales kuras
       * jadi 40, lalu staff hitung 230 fisik, formula = 40 + (230-700) =
       * -430 → NEGATIVE_STOCK error meskipun staff hitung benar.
       *
       * NEW: opname adalah PHYSICAL TRUTH. Pakai replace semantic:
       *   - realDelta = actual - currentStockNow  (delta yang benar2 di-apply)
       *   - newStock = currentStockNow + realDelta = actual  (count IS truth)
       *   - Movement record realDelta supaya inventory ledger balanced.
       *
       * Filter `computeDiff(line) !== 0` (= snapshot diff != 0) tetap di-pakai
       * untuk skip auto-filled lines (submit step auto-fill actualQty=
       * expectedQty kalau staff skip). Lines tanpa count nyata tidak boleh
       * trigger adjustment.
       *
       * Untuk shrinkage cost analytics (separate dari net adjustment),
       * stock_opname_lines.expectedQty + actualQty tetap ada — bisa di-query
       * untuk laporan "selisih ditemukan selama opname window".
       */

      // Lock all impacted ingredients up front for atomicity.
      const impactedIds = lines
        .filter((l) => l.actualQty !== null && computeDiff(l) !== 0)
        .map((l) => l.ingredientId);

      /* Sesi AE-81 — track per-line realDelta untuk:
       *  1. accounting hook section aggregation (Dr/Cr journal match stock change)
       *  2. audit / reporting (totalAbsDiffQty + Cost reflect actual adjustment) */
      const realDeltaByIngredient = new Map<string, number>();

      if (impactedIds.length > 0) {
        const liveIngs = await tx
          .select({
            id: ingredients.id,
            outletId: ingredients.outletId,
            currentStock: ingredients.currentStock,
            currentStockDecimal: ingredients.currentStockDecimal,
            deletedAt: ingredients.deletedAt,
          })
          .from(ingredients)
          .where(inArray(ingredients.id, impactedIds))
          .for("update");

        const liveById = new Map(liveIngs.map((r) => [r.id, r] as const));

        for (const line of lines) {
          if (line.actualQty === null) continue;
          // Sesi AE-15 — diff prefer decimal precision.
          const snapshotDiff = computeDiff(line);
          if (snapshotDiff === 0) continue;

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

          const oldDecimalCur = (() => {
            if (live.currentStockDecimal !== null) {
              const p = parseFloat(live.currentStockDecimal);
              return Number.isFinite(p) ? p : live.currentStock;
            }
            return live.currentStock;
          })();

          /* Sesi AE-81 — REPLACE semantic. */
          const actualDecimal = safeParseDec(
            line.actualQtyDecimal,
            line.actualQty,
          );
          const realDelta = actualDecimal - oldDecimalCur;
          if (realDelta === 0) {
            /* Stock sudah pas dengan count fisik (sales/purchases sudah
             * reconcile drift selama session). No movement needed. */
            continue;
          }

          /* Defensive guard — physical count harus >= 0. Schema CHECK
           * `actualQty >= 0` sudah enforce di submit time, tapi double-check
           * di sini supaya error message jelas kalau ada decimal corruption. */
          if (actualDecimal < 0) {
            throw new Error(
              `NEGATIVE_STOCK:${line.ingredientNameSnapshot}`,
            );
          }

          const newStock = computeNewStock({
            currentBigint: live.currentStock,
            currentDecimal: live.currentStockDecimal,
            delta: realDelta,
          });
          const movementDelta = formatMovementDelta(realDelta);

          await tx
            .update(ingredients)
            .set({
              currentStock: newStock.bigint,
              currentStockDecimal: newStock.decimal,
              updatedAt: new Date(),
              updatedBy: session.user.id,
            })
            .where(eq(ingredients.id, line.ingredientId));
          live.currentStock = newStock.bigint;
          live.currentStockDecimal = newStock.decimal;

          const [movement] = await tx
            .insert(inventoryMovements)
            .values({
              outletId: session.user.outletId,
              ingredientId: line.ingredientId,
              kind: "adjust",
              qtyDelta: movementDelta.bigint,
              qtyDeltaDecimal: movementDelta.decimal,
              unitCostAtMovement: line.unitCostAtSnapshot,
              referenceType: "manual",
              referenceId: v.sessionId,
              reason: `Opname ${sess.periodLabel} — adjust ${realDelta > 0 ? "+" : ""}${realDelta.toFixed(4)} (snapshot diff ${snapshotDiff > 0 ? "+" : ""}${snapshotDiff.toFixed(4)})`,
              createdBy: session.user.id,
            })
            .returning({ id: inventoryMovements.id });

          await tx
            .update(stockOpnameLines)
            .set({ movementId: movement.id })
            .where(eq(stockOpnameLines.id, line.id));

          realDeltaByIngredient.set(line.ingredientId, realDelta);
          movementsCreated++;
          totalAbsDiffQty += Math.abs(realDelta);
          totalAbsDiffCost += Math.abs(realDelta) * line.unitCostAtSnapshot;
        }
      }

      /* Sesi AE-63 phase5 — same bigint cast fix as submit (see comment di
       * atas). totalAbsDiffQty/Cost di-accumulate sebagai float, harus
       * Math.round sebelum tulis ke bigint column. */
      await tx
        .update(stockOpnameSessions)
        .set({
          status: "completed",
          finalizedAt: new Date(),
          finalizedBy: session.user.id,
          totalDiffQty: Math.round(totalAbsDiffQty),
          totalDiffCost: Math.round(totalAbsDiffCost),
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
    return fail("DB_ERROR", logAndSanitize(e, "stock-opname", "Operasi database gagal"));
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

  // Sesi U — Accounting auto-journal hook (opname adjustment).
  //
  // Sesi AE-81 — aggregate dari inventoryMovements yang BARU di-buat saat
  // finalize ini (kind='adjust' + referenceType='manual' + referenceId=sessionId),
  // bukan dari stock_opname_lines diff. Alasan: setelah replace-semantic fix,
  // movement.qtyDelta = realDelta (= actual - currentStockNow), bukan
  // snapshot_diff. Journal Dr/Cr harus match stock change yang BENAR2 di-apply
  // supaya asset balance tetap konsisten.
  //
  // Sebelumnya pakai snapshot_diff yang akan over/under-report kalau ada
  // sales/purchase antara snapshot dan finalize.
  if (result.movementsCreated > 0) {
    const ingSections = await db
      .select({
        section: ingredients.section,
        diffValue: sql<number>`SUM(
          ${inventoryMovements.unitCostAtMovement}::numeric * COALESCE(
            ${inventoryMovements.qtyDeltaDecimal},
            ${inventoryMovements.qtyDelta}::numeric
          )
        )`,
      })
      .from(inventoryMovements)
      .innerJoin(
        ingredients,
        eq(inventoryMovements.ingredientId, ingredients.id),
      )
      .where(
        and(
          eq(inventoryMovements.kind, "adjust"),
          eq(inventoryMovements.referenceType, "manual"),
          eq(inventoryMovements.referenceId, v.sessionId),
        ),
      )
      .groupBy(ingredients.section);

    const sectionDiffs = ingSections
      .map((r) => ({
        section: r.section as
          | "kitchen"
          | "bar"
          | "supporting"
          | "cleaning"
          | null,
        diffValue: Number(r.diffValue),
      }))
      .filter((s) => s.diffValue !== 0);

    if (sectionDiffs.length > 0) {
      const [sessRow] = await db
        .select({ periodLabel: stockOpnameSessions.periodLabel })
        .from(stockOpnameSessions)
        .where(eq(stockOpnameSessions.id, v.sessionId))
        .limit(1);
      const todayWib = new Date().toISOString().slice(0, 10);
      const { fireJournalHook, postJournalForOpnameAdjustment } = await import(
        "@/features/accounting/hooks"
      );
      const opnameArgs = {
        outletId: session.user.outletId,
        opnameSessionId: v.sessionId,
        sessionLabel: sessRow?.periodLabel ?? "—",
        sectionDiffs,
        entryDate: todayWib,
        actorId: session.user.id,
      };
      fireJournalHook(
        () => postJournalForOpnameAdjustment(opnameArgs),
        "opname_adjustment",
        {
          sourceId: v.sessionId,
          outletId: session.user.outletId,
          actorId: session.user.id,
        },
        { label: "opname_adjustment", args: opnameArgs },
      );
    }
  }

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
    return fail("DB_ERROR", logAndSanitize(e, "stock-opname", "Operasi database gagal"));
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
    return fail("DB_ERROR", logAndSanitize(e, "stock-opname", "Operasi database gagal"));
  }

  return ok({ sessionId: v.sessionId });
}

/**
 * Sesi AE-22 — Add ad-hoc item ke opname session.
 *
 * Use case: staff hitung opname, ketemu bahan baru / lupa di-master.
 * Dulu harus keluar opname → buka Bahan tab → create → kembali ke
 * opname. Sekarang bisa langsung dari mobile / backoffice.
 *
 * Behavior:
 *   - Cek nama duplikat di outlet (case-insensitive). Kalau exists,
 *     return CONFLICT — minta staff pakai search untuk count
 *     ingredient yang sudah ada (mencegah pollute master).
 *   - Auto-create ingredient master: currentStock=0, costPerUnit=0,
 *     notes stamped "Ditambahkan dari Opname [periodLabel] oleh
 *     [user]" supaya owner aware saat review.
 *   - Insert opname line: expectedQty=0 (belum pernah ada di stock),
 *     actualQty=user input. Diff = +actualQty (akan jadi adjust+
 *     movement saat finalize).
 *   - Update session.totalLines + countedLines.
 *
 * Permission: inventory.opname.add_item (sama scope dgn count, supaya
 * staff yang count juga boleh add). Owner review pas finalize.
 */
export async function addOpnameItemAdHoc(
  input: AddOpnameItemAdHocInput,
): Promise<ApiResult<OpnameLineWithIngredient>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.opname.add_item")) {
    return fail("FORBIDDEN", "Tidak punya hak tambah bahan di opname");
  }
  const parsed = addOpnameItemAdHocSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
      String(parsed.error.issues[0]?.path[0] ?? ""),
    );
  }
  const v = parsed.data;
  const trimmedName = v.name.trim();

  try {
    const result = await db.transaction(async (tx) => {
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

      // Cek duplikat ingredient name (case-insensitive) di outlet aktif.
      const existing = await tx
        .select({
          id: ingredients.id,
          name: ingredients.name,
        })
        .from(ingredients)
        .where(
          and(
            eq(ingredients.outletId, session.user.outletId),
            sql`lower(${ingredients.name}) = lower(${trimmedName})`,
            sql`${ingredients.deletedAt} IS NULL`,
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        throw new Error(`DUPLICATE:${existing[0]!.name}`);
      }

      const stamp = `Ditambahkan dari Opname ${sess.periodLabel} oleh ${session.user.name ?? "staff"}`;
      const [newIng] = await tx
        .insert(ingredients)
        .values({
          outletId: session.user.outletId,
          name: trimmedName,
          unit: v.unit.trim(),
          section: v.section ?? null,
          currentStock: 0,
          currentStockDecimal: "0.0000",
          costPerUnit: 0,
          notes: stamp,
          isActive: true,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        })
        .returning();
      if (!newIng) throw new Error("CREATE_FAILED");

      const actualRounded = Math.max(0, Math.round(v.actualQty));
      const [newLine] = await tx
        .insert(stockOpnameLines)
        .values({
          sessionId: v.sessionId,
          ingredientId: newIng.id,
          expectedQty: 0,
          expectedQtyDecimal: "0.0000",
          actualQty: actualRounded,
          actualQtyDecimal: v.actualQty.toFixed(4),
          unitCostAtSnapshot: 0,
          ingredientNameSnapshot: trimmedName,
          unitSnapshot: v.unit.trim(),
          note: v.note ?? null,
          countedAt: new Date(),
          countedBy: session.user.id,
        })
        .returning();
      if (!newLine) throw new Error("CREATE_FAILED");

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
          totalLines: stats?.total ?? sess.totalLines + 1,
          countedLines: stats?.counted ?? sess.countedLines + 1,
          updatedAt: new Date(),
        })
        .where(eq(stockOpnameSessions.id, v.sessionId));

      return { newLine, newIng };
    });

    await logAudit({
      eventType: "inventory.opname.add_item",
      userId: session.user.id,
      entityType: "stock_opname_line",
      entityId: result.newLine.id,
      payload: {
        summary: `Tambah bahan ad-hoc "${trimmedName}" ke opname`,
        context: {
          sessionId: v.sessionId,
          ingredientId: result.newIng.id,
          name: trimmedName,
          unit: v.unit,
          actualQty: v.actualQty,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    const lineWithIng: OpnameLineWithIngredient = {
      ...result.newLine,
      ingredient: {
        id: result.newIng.id,
        name: result.newIng.name,
        unit: result.newIng.unit,
        isActive: result.newIng.isActive,
        deletedAt: result.newIng.deletedAt,
        section: result.newIng.section,
        /* Sesi AE-62y — new ad-hoc ingredient lewat opname tidak punya
         * pack conversions; owner bisa add later via Edit Satuan modal. */
        packConversions: null,
      },
    };
    return ok(lineWithIng);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "NOT_FOUND") return fail("NOT_FOUND", "Sesi tidak ditemukan");
    if (msg === "BAD_STATE")
      return fail(
        "BAD_STATE",
        "Sesi sudah disubmit / selesai — tidak bisa tambah item.",
      );
    if (msg.startsWith("DUPLICATE:")) {
      const name = msg.slice("DUPLICATE:".length);
      return fail(
        "CONFLICT",
        `"${name}" sudah ada di master. Pakai search di list opname untuk count yang sudah ada.`,
        "name",
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "stock-opname", "Operasi database gagal"),
    );
  }
}
