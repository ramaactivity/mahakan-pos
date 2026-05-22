/**
 * Sesi AE-113 — Server queries untuk COGS + Variance report per bulan.
 *
 * Data sources:
 *   - Stock Awal: opname session last finalized BEFORE period start.
 *     stock_opname_lines.actual_qty_decimal + unit_cost_at_snapshot.
 *   - Pembelian: purchase_items WHERE purchases.purchase_date in period
 *     AND purchases.status != 'cancelled'.
 *   - Stock Akhir: opname session last finalized WITHIN or just after
 *     period end (per akhir bulan WIB).
 *   - Theoretical usage: SUM(recipe_ingredients.qty × transaction_items.qty)
 *     WHERE transactions in period AND status='paid'.
 */

import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  inventoryMovements,
  outlets,
  purchaseItems,
  purchases,
  recipeIngredients,
  recipes,
  stockOpnameLines,
  stockOpnameSessions,
  transactionItems,
  transactions,
} from "@/db/schema";
import {
  computeIngredientCogs,
  parseMonthlyPeriod,
  summarizeCogs,
  type IngredientCogsInput,
  type IngredientCogsRow,
  type CogsSummary,
} from "./cogs-calc";

export interface CogsReport {
  period: ReturnType<typeof parseMonthlyPeriod>;
  outletName: string;
  rows: IngredientCogsRow[];
  summary: CogsSummary;
  /** Banners untuk UI display kalau data tidak lengkap. */
  banners: string[];
  /** Last finalized opname info — supaya UI bisa show context. */
  lastOpname: {
    before: { id: string; periodLabel: string; finalizedAt: string } | null;
    within: { id: string; periodLabel: string; finalizedAt: string } | null;
  };
  /** Per-period purchase stats untuk surface ke UI. */
  purchaseStats: {
    activeCount: number;
    cancelledCount: number;
  };
}

/**
 * Main entry: fetch COGS + Variance report untuk outlet + bulan.
 */
export async function getCogsReport(args: {
  outletId: string;
  /** YYYY-MM */
  ym: string;
}): Promise<CogsReport> {
  const period = parseMonthlyPeriod(args.ym);
  const banners: string[] = [];

  // ──────────────────────────────────────────────────────────────
  // 1. Outlet info
  // ──────────────────────────────────────────────────────────────
  const [outlet] = await db
    .select({ name: outlets.name })
    .from(outlets)
    .where(eq(outlets.id, args.outletId))
    .limit(1);

  // ──────────────────────────────────────────────────────────────
  // 2. All active atomic ingredients (excl. preparations supaya tidak
  //    double-count; preparation cost cascading dari atomic bahan).
  //    User dapat opt-in untuk include preparations di future.
  // ──────────────────────────────────────────────────────────────
  const ings = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      section: ingredients.section,
      costPerUnit: ingredients.costPerUnit,
      isPreparation: ingredients.isPreparation,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, args.outletId),
        isNull(ingredients.deletedAt),
        eq(ingredients.isPreparation, false),
      ),
    );

  // ──────────────────────────────────────────────────────────────
  // 3. Last finalized opname BEFORE period start → stock awal source
  // ──────────────────────────────────────────────────────────────
  const [opnameBefore] = await db
    .select({
      id: stockOpnameSessions.id,
      periodLabel: stockOpnameSessions.periodLabel,
      finalizedAt: stockOpnameSessions.finalizedAt,
    })
    .from(stockOpnameSessions)
    .where(
      and(
        eq(stockOpnameSessions.outletId, args.outletId),
        eq(stockOpnameSessions.status, "completed"),
        lt(stockOpnameSessions.finalizedAt, new Date(`${period.fromDate}T00:00:00+07:00`)),
      ),
    )
    .orderBy(desc(stockOpnameSessions.finalizedAt))
    .limit(1);

  const stockAwalByIng = new Map<
    string,
    { qty: number; unitCost: number }
  >();
  /* AE-117 — Fallback map kalau no prev opname: net delta movements
   * dalam period per ingredient. Stock awal = current_stock - net_delta.
   * Math-guaranteed: stock_awal + delta = stock_akhir. */
  let periodMovementByIng: Map<string, number> | null = null;

  if (opnameBefore) {
    const lines = await db
      .select({
        ingredientId: stockOpnameLines.ingredientId,
        actualQtyDecimal: stockOpnameLines.actualQtyDecimal,
        unitCostAtSnapshot: stockOpnameLines.unitCostAtSnapshot,
      })
      .from(stockOpnameLines)
      .where(eq(stockOpnameLines.sessionId, opnameBefore.id));
    for (const l of lines) {
      const qty = l.actualQtyDecimal !== null ? Number(l.actualQtyDecimal) : 0;
      stockAwalByIng.set(l.ingredientId, {
        qty,
        unitCost: l.unitCostAtSnapshot,
      });
    }
  } else {
    banners.push(
      `Belum ada opname sebelum ${period.fromDate}. Stock Awal di-derive dari current stock minus movements bulan ini (math-guaranteed: awal + delta = akhir).`,
    );

    const periodMovements = await db.execute<{
      ingredient_id: string;
      net_delta: string;
    }>(sql`
      SELECT
        im.ingredient_id,
        COALESCE(SUM(im.qty_delta_decimal), 0)::text AS net_delta
      FROM inventory_movements im
      WHERE im.outlet_id = ${args.outletId}
        AND im.created_at >= ${period.fromDate + ' 00:00:00+07:00'}
        AND im.created_at <= ${period.toDate + ' 23:59:59+07:00'}
      GROUP BY im.ingredient_id
    `);
    const movArr = ((periodMovements as unknown as { rows?: unknown[] }).rows ?? []) as Array<{
      ingredient_id: string; net_delta: string;
    }>;
    periodMovementByIng = new Map(movArr.map((r) => [r.ingredient_id, Number(r.net_delta)]));
  }

  // ──────────────────────────────────────────────────────────────
  // 4. Pembelian within period — separate active vs cancelled counts.
  //    For COGS computation, use ONLY active purchases.
  //    Surface cancelled count to UI for transparency.
  //
  //    Query: join via inventory_movements (master unit qty, source of
  //    truth post-AE-43). purchase_items.qty_decimal is RAW input, may
  //    not be in master unit kalau ada conversion.
  // ──────────────────────────────────────────────────────────────
  const purchaseStatsRows = await db.execute<{ status: string; count: string }>(sql`
    SELECT p.status, COUNT(*)::text AS count
    FROM purchases p
    WHERE p.outlet_id = ${args.outletId}
      AND p.purchase_date >= ${period.fromDate}
      AND p.purchase_date <= ${period.toDate}
    GROUP BY p.status
  `);
  const psArr = ((purchaseStatsRows as unknown as { rows?: unknown[] }).rows ?? []) as Array<{ status: string; count: string }>;
  let activePurchaseCount = 0;
  let cancelledPurchaseCount = 0;
  for (const r of psArr) {
    const n = parseInt(r.count, 10);
    if (r.status === "cancelled") cancelledPurchaseCount += n;
    else activePurchaseCount += n;
  }
  if (cancelledPurchaseCount > 0 && activePurchaseCount === 0) {
    banners.push(
      `Tidak ada pembelian aktif di periode ${period.label} (${cancelledPurchaseCount} dibatalkan). Tambah pembelian via Inventory → Pembelian → Catat Pembelian.`,
    );
  }

  const purchaseRows = await db
    .select({
      ingredientId: purchaseItems.ingredientId,
      movementQtyDeltaDecimal: inventoryMovements.qtyDeltaDecimal,
      qtyDecimalRaw: purchaseItems.qtyDecimal,
      qtyBigint: purchaseItems.qty,
      totalCost: purchaseItems.totalCost,
    })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
    .leftJoin(
      inventoryMovements,
      eq(purchaseItems.movementId, inventoryMovements.id),
    )
    .where(
      and(
        eq(purchases.outletId, args.outletId),
        gte(purchases.purchaseDate, period.fromDate),
        lte(purchases.purchaseDate, period.toDate),
        sql`${purchases.status} != 'cancelled'`,
      ),
    );

  const pembelianByIng = new Map<string, { qty: number; total: number }>();
  for (const r of purchaseRows) {
    /* Master unit qty — fallback ke purchase_items.qty_decimal kalau
     * movement row hilang (legacy/corrupt). */
    let qty: number;
    if (r.movementQtyDeltaDecimal !== null && r.movementQtyDeltaDecimal !== undefined) {
      qty = Number(r.movementQtyDeltaDecimal);
    } else if (r.qtyDecimalRaw !== null && r.qtyDecimalRaw !== undefined) {
      qty = Number(r.qtyDecimalRaw);
    } else {
      qty = r.qtyBigint;
    }
    const cur = pembelianByIng.get(r.ingredientId) ?? { qty: 0, total: 0 };
    cur.qty += qty;
    cur.total += r.totalCost;
    pembelianByIng.set(r.ingredientId, cur);
  }

  // ──────────────────────────────────────────────────────────────
  // 5. Stock akhir from opname within period (or just after, until today
  //    if period current month). Latest finalized opname.
  // ──────────────────────────────────────────────────────────────
  const [opnameWithin] = await db
    .select({
      id: stockOpnameSessions.id,
      periodLabel: stockOpnameSessions.periodLabel,
      finalizedAt: stockOpnameSessions.finalizedAt,
    })
    .from(stockOpnameSessions)
    .where(
      and(
        eq(stockOpnameSessions.outletId, args.outletId),
        eq(stockOpnameSessions.status, "completed"),
        gte(
          stockOpnameSessions.finalizedAt,
          new Date(`${period.fromDate}T00:00:00+07:00`),
        ),
      ),
    )
    .orderBy(asc(stockOpnameSessions.finalizedAt))
    .limit(1);

  const stockAkhirByIng = new Map<string, number>();
  if (opnameWithin) {
    const lines = await db
      .select({
        ingredientId: stockOpnameLines.ingredientId,
        actualQtyDecimal: stockOpnameLines.actualQtyDecimal,
      })
      .from(stockOpnameLines)
      .where(eq(stockOpnameLines.sessionId, opnameWithin.id));
    for (const l of lines) {
      const qty = l.actualQtyDecimal !== null ? Number(l.actualQtyDecimal) : 0;
      stockAkhirByIng.set(l.ingredientId, qty);
    }
  } else {
    banners.push(
      `Belum ada opname dalam periode ${period.label}. Stock Akhir di-asumsikan 0 — COGS over-stated.`,
    );
  }

  // ──────────────────────────────────────────────────────────────
  // 6. Theoretical usage: SUM(recipe_ingredients.qty × transaction_items.qty)
  //    WHERE transactions in period AND status='paid'.
  //    Group by ingredient_id.
  //
  //    JOIN chain:
  //      transactions → transaction_items → recipes (via menu_item_id + variant)
  //        → recipe_ingredients → ingredients
  //
  //    Variant handling: recipe per menu_item × variant. Match by exact variant.
  // ──────────────────────────────────────────────────────────────
  const theoreticalRows = await db.execute<{
    ingredient_id: string;
    total_qty: string;
  }>(sql`
    SELECT
      ri.ingredient_id,
      SUM(ri.qty * ti.quantity) AS total_qty
    FROM transactions tr
    INNER JOIN transaction_items ti ON ti.transaction_id = tr.id
    INNER JOIN recipes rc ON rc.menu_item_id = ti.menu_item_id
      AND (
        (rc.variant IS NULL AND ti.variant IS NULL)
        OR (rc.variant = ti.variant)
      )
    INNER JOIN recipe_ingredients ri ON ri.recipe_id = rc.id
    WHERE tr.outlet_id = ${args.outletId}
      AND tr.status = 'paid'
      AND tr.created_at >= ${period.fromDate + " 00:00:00+07:00"}
      AND tr.created_at <= ${period.toDate + " 23:59:59+07:00"}
    GROUP BY ri.ingredient_id
  `);
  const theoreticalArr = ((theoreticalRows as unknown as { rows?: unknown[] }).rows ?? []) as Array<{
    ingredient_id: string;
    total_qty: string;
  }>;
  const theoreticalByIng = new Map<string, number>();
  for (const r of theoreticalArr) {
    theoreticalByIng.set(r.ingredient_id, Number(r.total_qty));
  }

  // ──────────────────────────────────────────────────────────────
  // 7. Need current_stock_decimal per ingredient untuk fallback stock awal
  //    calc (kalau periodMovementByIng available). Already fetched in
  //    `ings` query → use ing.currentStockDecimal.
  // ──────────────────────────────────────────────────────────────
  /* Refetch current stock decimal (was not selected in original ings query). */
  const currentStockRows = await db
    .select({
      id: ingredients.id,
      currentStockDecimal: ingredients.currentStockDecimal,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, args.outletId),
        isNull(ingredients.deletedAt),
      ),
    );
  const currentStockByIng = new Map(
    currentStockRows.map((r) => [r.id, Number(r.currentStockDecimal ?? 0)]),
  );

  // ──────────────────────────────────────────────────────────────
  // 8. Compute per-ingredient rows
  // ──────────────────────────────────────────────────────────────
  const rows: IngredientCogsRow[] = [];
  for (const ing of ings) {
    const sa = stockAwalByIng.get(ing.id);
    const pb = pembelianByIng.get(ing.id);
    const sk = stockAkhirByIng.get(ing.id);
    const th = theoreticalByIng.get(ing.id);

    /* AE-117 — Derive stock awal qty when no prev opname:
     * stock_awal = current_stock - SUM(movements_in_period)
     * Math-guaranteed: stock_awal + delta = stock_akhir. */
    let stockAwalQty = sa?.qty ?? 0;
    let stockAwalAvgPrice = sa?.unitCost ?? ing.costPerUnit;
    if (!sa && periodMovementByIng) {
      const current = currentStockByIng.get(ing.id) ?? 0;
      const netDelta = periodMovementByIng.get(ing.id) ?? 0;
      stockAwalQty = current - netDelta;
      // Harga awal pakai costPerUnit master (Rama's request AE-117).
      stockAwalAvgPrice = ing.costPerUnit;
    }

    /* Skip bahan kalau benar-benar no data (clean output). */
    if (!sa && !pb && !sk && !th && stockAwalQty === 0) continue;

    const input: IngredientCogsInput = {
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit,
      section: ing.section,
      stockAwalQty,
      stockAwalAvgPrice,
      pembelianQty: pb?.qty ?? 0,
      pembelianTotal: pb?.total ?? 0,
      stockAkhirQty: sk ?? currentStockByIng.get(ing.id) ?? 0,
      theoreticalUsageQty: th ?? 0,
      currentCostPerUnit: ing.costPerUnit,
    };

    rows.push(computeIngredientCogs(input));
  }

  // Sort by section then name
  rows.sort((a, b) => {
    const sa = a.section ?? "zzz";
    const sb = b.section ?? "zzz";
    if (sa !== sb) return sa.localeCompare(sb);
    return a.name.localeCompare(b.name);
  });

  return {
    period,
    outletName: outlet?.name ?? "Mahakan",
    rows,
    summary: summarizeCogs(rows),
    banners,
    lastOpname: {
      before: opnameBefore
        ? {
            id: opnameBefore.id,
            periodLabel: opnameBefore.periodLabel,
            finalizedAt: opnameBefore.finalizedAt?.toISOString() ?? "",
          }
        : null,
      within: opnameWithin
        ? {
            id: opnameWithin.id,
            periodLabel: opnameWithin.periodLabel,
            finalizedAt: opnameWithin.finalizedAt?.toISOString() ?? "",
          }
        : null,
    },
    purchaseStats: {
      activeCount: activePurchaseCount,
      cancelledCount: cancelledPurchaseCount,
    },
  };
}
