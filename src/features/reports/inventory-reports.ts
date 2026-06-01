import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { ingredients } from "@/db/schema";
import {
  fetchPurchaseRollup,
  fetchPurchasesByIngredient,
} from "@/features/purchases/queries";
import type {
  HppReport,
  HppReportRow,
  PurchaseRollupReport,
} from "./types";
import type { IngredientSection } from "@/features/inventory";

const SECTION_LABELS: Record<string, string> = {
  kitchen: "Kitchen",
  bar: "Bar",
  supporting: "Supporting Supplies",
  cleaning: "Cleaning Supplies",
  unassigned: "Belum diset",
};

function sectionLabel(s: IngredientSection | null): string {
  return s ? SECTION_LABELS[s] ?? s : SECTION_LABELS.unassigned;
}

export interface OpnameSnapshot {
  sessionId: string;
  finalizedAt: Date;
  /** Map ingredientId → actualQty (only counted lines). */
  qtyByIngredient: Map<string, number>;
  /** Map ingredientId → unitCostAtSnapshot. */
  costByIngredient: Map<string, number>;
}

/* Sesi AE-131 perf — combine session lookup + load lines into ONE query
 * via CTE (saves 1 RTT). Caller pass WHERE predicate untuk session
 * selection; CTE picks the latest, LEFT JOIN lines, single round-trip.
 *
 * Returns empty maps kalau no session matches (callers expect null —
 * handled di wrapper functions below). */
async function fetchOpnameSnapshotByPredicate(
  sessionPredicate: ReturnType<typeof sql>,
): Promise<OpnameSnapshot | null> {
  type Row = {
    session_id: string;
    finalized_at: Date | null;
    ingredient_id: string | null;
    actual_qty: number | null;
    unit_cost_at_snapshot: number | null;
  };
  const result = await db.execute(sql`
    WITH latest_session AS (
      SELECT id, finalized_at
      FROM stock_opname_sessions
      WHERE ${sessionPredicate}
      ORDER BY finalized_at DESC
      LIMIT 1
    )
    SELECT
      ls.id AS session_id,
      ls.finalized_at,
      l.ingredient_id,
      l.actual_qty,
      l.unit_cost_at_snapshot
    FROM latest_session ls
    LEFT JOIN stock_opname_lines l ON l.session_id = ls.id
  `);
  const rows = (result as unknown as { rows: Row[] }).rows
    ?? (result as unknown as Row[]);
  if (rows.length === 0 || !rows[0]?.session_id || !rows[0]?.finalized_at) {
    return null;
  }
  const sessionId = rows[0].session_id;
  const finalizedAt = new Date(rows[0].finalized_at);
  const qtyByIngredient = new Map<string, number>();
  const costByIngredient = new Map<string, number>();
  for (const r of rows) {
    if (!r.ingredient_id) continue; // LEFT JOIN with no lines
    if (r.actual_qty !== null) {
      qtyByIngredient.set(r.ingredient_id, Number(r.actual_qty));
    }
    if (r.unit_cost_at_snapshot !== null) {
      costByIngredient.set(r.ingredient_id, Number(r.unit_cost_at_snapshot));
    }
  }
  return { sessionId, finalizedAt, qtyByIngredient, costByIngredient };
}

export async function fetchLatestOpnameBefore(
  outletId: string,
  beforeDate: string,
): Promise<OpnameSnapshot | null> {
  return fetchOpnameSnapshotByPredicate(sql`
    outlet_id = ${outletId}::uuid
    AND status = 'completed'
    AND finalized_at < (${beforeDate}::date AT TIME ZONE 'Asia/Jakarta')
  `);
}

async function fetchLatestOpnameWithin(
  outletId: string,
  fromDate: string,
  toDate: string,
): Promise<OpnameSnapshot | null> {
  return fetchOpnameSnapshotByPredicate(sql`
    outlet_id = ${outletId}::uuid
    AND status = 'completed'
    AND finalized_at >= (${fromDate}::date AT TIME ZONE 'Asia/Jakarta')
    AND finalized_at < ((${toDate}::date + interval '1 day') AT TIME ZONE 'Asia/Jakarta')
  `);
}

/**
 * HPP / COGS Period Report. Replaces Owner's COGS spreadsheet.
 *
 * Stock Awal = qty di opname terakhir SEBELUM period.from
 *              fallback: 0 + partial=true
 * Pembelian  = sum(purchase_items.qty/cost) untuk status non-cancelled
 *              dengan purchase_date IN [from, to]
 * Stock Akhir = qty di opname terakhir DALAM period [from, to]
 *               fallback: ingredients.current_stock (NOW) + partial=true
 *
 * HPP Cost = stockAwalCost + pembelianCost − stockAkhirCost (accounting).
 */
export async function fetchHppReport(
  outletId: string,
  dateFrom: string,
  dateTo: string,
): Promise<HppReport> {
  const [activeIngredients, stockAwal, stockAkhir, purchasesByIng] =
    await Promise.all([
      db
        .select({
          id: ingredients.id,
          name: ingredients.name,
          unit: ingredients.unit,
          section: ingredients.section,
          currentStock: ingredients.currentStock,
          costPerUnit: ingredients.costPerUnit,
        })
        .from(ingredients)
        .where(
          and(
            eq(ingredients.outletId, outletId),
            isNull(ingredients.deletedAt),
            eq(ingredients.isActive, true),
            /* Sesi AE-176 — preparation tidak masuk opname (dibuat in-house dari
             * resep; bahan baku-nya sudah dihitung terpisah). Keluarkan juga
             * dari laporan HPP/COGS supaya tidak permanen "partial" + double
             * count. Konsisten dgn fetchActiveIngredientsForSnapshot. */
            eq(ingredients.isPreparation, false),
          ),
        )
        .orderBy(ingredients.name),
      fetchLatestOpnameBefore(outletId, dateFrom),
      fetchLatestOpnameWithin(outletId, dateFrom, dateTo),
      fetchPurchasesByIngredient(outletId, dateFrom, dateTo),
    ]);

  const rows: HppReportRow[] = [];
  let totalStockAwalCost = 0;
  let totalPembelianCost = 0;
  let totalStockAkhirCost = 0;
  let totalHppCost = 0;
  let hasPartialRows = false;

  for (const ing of activeIngredients) {
    // Stock Awal
    const awalQty = stockAwal?.qtyByIngredient.get(ing.id);
    const awalCostPerUnit =
      stockAwal?.costByIngredient.get(ing.id) ?? ing.costPerUnit;
    const stockAwalQty = awalQty ?? 0;
    const stockAwalCost = stockAwalQty * awalCostPerUnit;

    // Pembelian
    const purch = purchasesByIng.get(ing.id);
    const pembelianQty = purch?.qty ?? 0;
    const pembelianCost = purch?.cost ?? 0;

    // Stock Akhir
    const akhirQty = stockAkhir?.qtyByIngredient.get(ing.id);
    const akhirCostPerUnit =
      stockAkhir?.costByIngredient.get(ing.id) ?? ing.costPerUnit;
    const stockAkhirQty = akhirQty ?? ing.currentStock;
    const stockAkhirCost = stockAkhirQty * akhirCostPerUnit;

    const partial = awalQty === undefined || akhirQty === undefined;
    if (partial) hasPartialRows = true;

    const hppQty = stockAwalQty + pembelianQty - stockAkhirQty;
    const hppCost = stockAwalCost + pembelianCost - stockAkhirCost;

    rows.push({
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit,
      section: ing.section,
      stockAwalQty,
      stockAwalCost,
      pembelianQty,
      pembelianCost,
      stockAkhirQty,
      stockAkhirCost,
      hppQty,
      hppCost,
      partial,
    });

    totalStockAwalCost += stockAwalCost;
    totalPembelianCost += pembelianCost;
    totalStockAkhirCost += stockAkhirCost;
    totalHppCost += hppCost;
  }

  // Group by section
  const sectionMap = new Map<
    string,
    {
      section: IngredientSection | null;
      stockAwalCost: number;
      pembelianCost: number;
      stockAkhirCost: number;
      hppCost: number;
    }
  >();
  for (const r of rows) {
    const key = r.section ?? "__unassigned";
    const cur = sectionMap.get(key) ?? {
      section: r.section,
      stockAwalCost: 0,
      pembelianCost: 0,
      stockAkhirCost: 0,
      hppCost: 0,
    };
    cur.stockAwalCost += r.stockAwalCost;
    cur.pembelianCost += r.pembelianCost;
    cur.stockAkhirCost += r.stockAkhirCost;
    cur.hppCost += r.hppCost;
    sectionMap.set(key, cur);
  }

  const sectionOrder = ["kitchen", "bar", "supporting", "cleaning", "__unassigned"];
  const bySection = sectionOrder
    .filter((k) => sectionMap.has(k))
    .map((k) => {
      const s = sectionMap.get(k)!;
      return {
        section: s.section,
        sectionLabel: sectionLabel(s.section),
        stockAwalCost: s.stockAwalCost,
        pembelianCost: s.pembelianCost,
        stockAkhirCost: s.stockAkhirCost,
        hppCost: s.hppCost,
      };
    });

  return {
    period: { from: dateFrom, to: dateTo },
    rows,
    totals: {
      stockAwalCost: totalStockAwalCost,
      pembelianCost: totalPembelianCost,
      stockAkhirCost: totalStockAkhirCost,
      hppCost: totalHppCost,
    },
    bySection,
    hasPartialRows,
    opnameRefs: {
      stockAwalSessionId: stockAwal?.sessionId ?? null,
      stockAwalSessionDate: stockAwal?.finalizedAt
        ? stockAwal.finalizedAt.toISOString().slice(0, 10)
        : null,
      stockAkhirSessionId: stockAkhir?.sessionId ?? null,
      stockAkhirSessionDate: stockAkhir?.finalizedAt
        ? stockAkhir.finalizedAt.toISOString().slice(0, 10)
        : null,
    },
  };
}

/**
 * Purchase Rollup pivot. Replaces Owner's Rekap Inv Detail.
 */
export async function fetchPurchaseRollupReport(
  outletId: string,
  dateFrom: string,
  dateTo: string,
): Promise<PurchaseRollupReport> {
  const cells = await fetchPurchaseRollup(outletId, dateFrom, dateTo);

  let grandTotal = 0;
  const byDateMap = new Map<string, number>();
  const byColMap = new Map<
    string,
    { section: IngredientSection | null; paymentMethod: typeof cells[number]["paymentMethod"]; total: number }
  >();

  for (const c of cells) {
    grandTotal += c.totalAmount;
    byDateMap.set(
      c.purchaseDate,
      (byDateMap.get(c.purchaseDate) ?? 0) + c.totalAmount,
    );
    const colKey = `${c.section ?? ""}_${c.paymentMethod}`;
    const cur = byColMap.get(colKey) ?? {
      section: (c.section as IngredientSection | null) ?? null,
      paymentMethod: c.paymentMethod,
      total: 0,
    };
    cur.total += c.totalAmount;
    byColMap.set(colKey, cur);
  }

  return {
    period: { from: dateFrom, to: dateTo },
    cells: cells.map((c) => ({
      date: c.purchaseDate,
      section: (c.section as IngredientSection | null) ?? null,
      paymentMethod: c.paymentMethod,
      totalAmount: c.totalAmount,
    })),
    grandTotal,
    byDate: Array.from(byDateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({ date, total })),
    byColumn: Array.from(byColMap.values()),
  };
}
