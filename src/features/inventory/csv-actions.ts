"use server";

/**
 * Sesi AE-112 — Server actions for ingredient CSV bulk operations.
 *
 * Owner-only. Wraps existing CRUD via direct DB write with proper safety:
 *   - Atomic transaction (all-or-nothing)
 *   - Audit log: ingredient.bulk_update with summary
 *   - currentStock IGNORED (must use Opname for stock changes)
 *   - No auto-delete missing rows
 *   - Existing actions like updateIngredient trigger preparation cascade —
 *     here we do simpler direct UPDATE since bulk-update typically affects
 *     master data (name/section/cost) where cost cascade is per-bahan.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { ingredients, outlets } from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { cascadeCostUpdate } from "./preparation-flow";
import {
  computeDiff,
  parseIngredientsCsv,
  serializeIngredientsCsv,
  type ExistingIngredientLite,
  type IngredientCsvRow,
  type RowDiff,
} from "./csv-io";
import { fail, ok, type ApiResult } from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

// ──────────────────────────────────────────────────────────────────
// EXPORT
// ──────────────────────────────────────────────────────────────────

export async function exportIngredientsCsv(): Promise<
  ApiResult<{ csv: string; filename: string; rowCount: number }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.ingredient.update")) {
    return fail("FORBIDDEN", "Tidak punya hak export bahan");
  }

  const [outlet] = await db
    .select({ name: outlets.name })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);

  const rows = await db
    .select()
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, session.user.outletId),
        isNull(ingredients.deletedAt),
      ),
    );

  const csv = serializeIngredientsCsv(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      section: r.section,
      unit: r.unit,
      costPerUnit: r.costPerUnit,
      currentStockDecimal: r.currentStockDecimal ?? "0.0000",
      reorderThreshold: r.reorderThreshold,
      notes: r.notes,
    })),
    {
      generatedAt: new Date(),
      outletName: outlet?.name ?? "Mahakan",
    },
  );

  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const filename = `mahakan-bahan-${ts}.csv`;

  return ok({ csv, filename, rowCount: rows.length });
}

// ──────────────────────────────────────────────────────────────────
// PREVIEW (parse + diff, no DB write)
// ──────────────────────────────────────────────────────────────────

export async function previewIngredientsBulkUpdate(
  csvText: string,
): Promise<
  ApiResult<{
    rows: RowDiff[];
    summary: {
      create: number;
      update: number;
      unchanged: number;
      error: number;
      total: number;
    };
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.ingredient.update")) {
    return fail("FORBIDDEN", "Tidak punya hak preview bulk update");
  }

  if (typeof csvText !== "string" || csvText.length === 0) {
    return fail("VALIDATION_ERROR", "CSV kosong");
  }
  if (csvText.length > 5_000_000) {
    return fail("FILE_TOO_LARGE", "CSV >5MB. Pakai filter / split file.");
  }

  const parsed = parseIngredientsCsv(csvText);

  // Fetch existing ingredients (only outlet-scoped + active)
  const existing = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      section: ingredients.section,
      unit: ingredients.unit,
      costPerUnit: ingredients.costPerUnit,
      reorderThreshold: ingredients.reorderThreshold,
      notes: ingredients.notes,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, session.user.outletId),
        isNull(ingredients.deletedAt),
      ),
    );

  const existingLite: ExistingIngredientLite[] = existing.map((e) => ({
    id: e.id,
    name: e.name,
    section: e.section,
    unit: e.unit,
    costPerUnit: e.costPerUnit,
    reorderThreshold: e.reorderThreshold,
    notes: e.notes,
  }));

  const diff = computeDiff(parsed, existingLite);
  return ok(diff);
}

// ──────────────────────────────────────────────────────────────────
// APPLY (commit changes in transaction)
// ──────────────────────────────────────────────────────────────────

export interface ApplyResult {
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedErrorCount: number;
  cascadedPreparationCount: number;
}

export async function applyIngredientsBulkUpdate(
  csvText: string,
): Promise<ApiResult<ApplyResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.ingredient.update")) {
    return fail("FORBIDDEN", "Tidak punya hak bulk update bahan");
  }

  if (typeof csvText !== "string" || csvText.length === 0) {
    return fail("VALIDATION_ERROR", "CSV kosong");
  }

  const parsed = parseIngredientsCsv(csvText);

  // Re-compute diff against current DB state (re-fetch supaya tidak stale)
  const existing = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      section: ingredients.section,
      unit: ingredients.unit,
      costPerUnit: ingredients.costPerUnit,
      reorderThreshold: ingredients.reorderThreshold,
      notes: ingredients.notes,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, session.user.outletId),
        isNull(ingredients.deletedAt),
      ),
    );

  const existingLite: ExistingIngredientLite[] = existing.map((e) => ({
    id: e.id,
    name: e.name,
    section: e.section,
    unit: e.unit,
    costPerUnit: e.costPerUnit,
    reorderThreshold: e.reorderThreshold,
    notes: e.notes,
  }));

  const diff = computeDiff(parsed, existingLite);

  if (diff.summary.error > 0) {
    return fail(
      "HAS_VALIDATION_ERRORS",
      `${diff.summary.error} row(s) dengan error. Fix dulu di CSV sebelum apply.`,
    );
  }

  if (diff.summary.create + diff.summary.update === 0) {
    return ok({
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: diff.summary.unchanged,
      skippedErrorCount: 0,
      cascadedPreparationCount: 0,
    });
  }

  const byExistingId = new Map(existingLite.map((e) => [e.id, e]));

  let createdCount = 0;
  let updatedCount = 0;
  let cascadedPreparationCount = 0;

  try {
    await db.transaction(async (tx) => {
      const costChangedIngredientIds: string[] = [];

      for (const row of diff.rows) {
        if (row.action === "error" || row.action === "unchanged") continue;
        if (!row.parsed) continue;

        if (row.action === "create") {
          const [created] = await tx
            .insert(ingredients)
            .values({
              outletId: session.user.outletId,
              name: row.parsed.name,
              section: row.parsed.section,
              unit: row.parsed.unit,
              costPerUnit: row.parsed.costPerUnit,
              currentStock: 0,
              currentStockDecimal: "0.0000",
              reorderThreshold: row.parsed.threshold,
              notes: row.parsed.notes,
              isPreparation: false,
              createdBy: session.user.id,
              updatedBy: session.user.id,
            })
            .returning({ id: ingredients.id });
          if (created) createdCount++;
        } else if (row.action === "update") {
          const existing = row.parsed.id ? byExistingId.get(row.parsed.id) : null;
          if (!existing) continue;
          const costChanged =
            existing.costPerUnit !== row.parsed.costPerUnit;
          await tx
            .update(ingredients)
            .set({
              name: row.parsed.name,
              section: row.parsed.section,
              unit: row.parsed.unit,
              costPerUnit: row.parsed.costPerUnit,
              reorderThreshold: row.parsed.threshold,
              notes: row.parsed.notes,
              updatedAt: new Date(),
              updatedBy: session.user.id,
              ...(costChanged
                ? { costLastChangedAt: new Date() }
                : {}),
            })
            .where(eq(ingredients.id, existing.id));
          updatedCount++;
          if (costChanged) {
            costChangedIngredientIds.push(existing.id);
          }
        }
      }

      // Cascade cost updates ke preparation recipes (inside same tx supaya
      // atomic dengan UPDATE).
      for (const id of costChangedIngredientIds) {
        try {
          const cascadeRes = await cascadeCostUpdate(
            tx,
            session.user.outletId,
            id,
            session.user.id,
          );
          cascadedPreparationCount += cascadeRes.recomputedPrepIds.length;
        } catch {
          // Cascade failure inside tx → rollback semua. Re-throw supaya
          // tx rollback. Aman karena kita dalam catch outer too.
          throw new Error("CASCADE_FAILED");
        }
      }
    });
  } catch (e) {
    if (e instanceof Error && /unique|duplicate/i.test(e.message)) {
      return fail(
        "DUPLICATE_NAME",
        "Ada nama bahan yang duplikat — cek CSV. Transaction rolled back.",
      );
    }
    if (e instanceof Error && e.message === "CASCADE_FAILED") {
      return fail(
        "CASCADE_FAILED",
        "Cost cascade ke preparation recipe gagal — transaction rolled back. Cek log.",
      );
    }
    return fail(
      "DB_ERROR",
      e instanceof Error ? e.message : "Database error — transaction rolled back.",
    );
  }

  // Audit log
  await logAudit({
    eventType: "inventory.ingredient.bulk_update",
    userId: session.user.id,
    entityType: "ingredient",
    entityId: "bulk",
    payload: {
      summary: `Bulk CSV update: ${createdCount} created, ${updatedCount} updated, ${diff.summary.unchanged} unchanged`,
      after: {
        created: createdCount,
        updated: updatedCount,
        unchanged: diff.summary.unchanged,
        cascadedPreparations: cascadedPreparationCount,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  return ok({
    createdCount,
    updatedCount,
    unchangedCount: diff.summary.unchanged,
    skippedErrorCount: 0,
    cascadedPreparationCount,
  });
}

// Re-export types untuk client import
export type { IngredientCsvRow };
