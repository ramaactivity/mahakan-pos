import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stockOpnameLines, stockOpnameSessions } from "@/db/schema";
import { fetchPurchasesByIngredient } from "@/features/purchases/queries";
import { fetchLatestOpnameBefore } from "@/features/reports/inventory-reports";

export interface OpnameLineFlow {
  /** From prior opname's actualQty, OR 0 if no prior opname (hasPriorOpname=false). */
  openingQty: number;
  /** Cost-per-unit at the prior opname's snapshot (frozen), OR
   * stockOpnameLines.unitCostAtSnapshot fallback. */
  openingUnitCost: number;
  /** Sum purchase_items.qty for this ingredient inside the flow window
   * (windowFrom..windowTo). 0 if no purchases. */
  purchasesQty: number;
  /** Sum purchase_items.totalCost for this ingredient inside the flow window. */
  purchasesCost: number;
}

export interface OpnameInventoryFlow {
  /** Map ingredientId → flow data. Only ingredients in this session's lines
   * are present. Missing ingredients = treat as zero values. */
  perIngredient: Map<string, OpnameLineFlow>;
  /** True when a prior completed opname was found. False = openingQty defaults
   * to 0 across the board; staff/Owner should treat opening as estimate. */
  hasPriorOpname: boolean;
  /** ISO date (YYYY-MM-DD, Asia/Jakarta) of prior opname's finalizedAt. */
  priorOpnameDate: string | null;
  /** Inclusive lower bound of the purchase aggregation window. */
  windowFrom: string;
  /** Inclusive upper bound of the purchase aggregation window. */
  windowTo: string;
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function jakartaIsoDate(d: Date): string {
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  return wib.toISOString().slice(0, 10);
}

function jakartaIsoDatePlusOne(d: Date): string {
  const wib = new Date(d.getTime() + WIB_OFFSET_MS + 24 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

function jakartaFirstOfMonth(d: Date): string {
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/**
 * Per-line inventory flow data for the OpnameCountView "Stok Awal /
 * Pembelian / Bahan Terpakai" columns. Reuses the HPP report's helpers
 * so the math di opname view ↔ HPP report ↔ accounting hooks selalu
 * konsisten — no drift, no duplicate logic.
 *
 * Window semantics:
 * - upper bound (windowTo) = session.startedAt (Jakarta calendar date)
 * - lower bound (windowFrom):
 *   - if a prior completed opname exists: prior.finalizedAt + 1 day
 *     → captures purchases between two opname cycles inclusively
 *   - else: first day of current month (Jakarta) — best-effort fallback
 *     so the Pembelian column still shows something useful
 */
export async function fetchOpnameInventoryFlow(
  outletId: string,
  sessionId: string,
): Promise<OpnameInventoryFlow | null> {
  const [sess] = await db
    .select({
      id: stockOpnameSessions.id,
      outletId: stockOpnameSessions.outletId,
      startedAt: stockOpnameSessions.startedAt,
    })
    .from(stockOpnameSessions)
    .where(eq(stockOpnameSessions.id, sessionId))
    .limit(1);
  if (!sess || sess.outletId !== outletId) return null;

  const sessionStartIso = jakartaIsoDate(sess.startedAt);
  const prior = await fetchLatestOpnameBefore(outletId, sessionStartIso);

  /* Sesi AE-194 — jendela pembelian dihitung dari TANGGAL HITUNG opname
   * sebelumnya, bukan tanggal persetujuannya. Dengan `finalizedAt`, opname
   * Juni yang dihitung 30 Juni tapi baru disetujui 14 Juli membuat jendela
   * mulai 15 Juli — seluruh belanja 1–14 Juli hilang dari layar opname. */
  const windowFrom = prior?.countedAt
    ? jakartaIsoDatePlusOne(prior.countedAt)
    : jakartaFirstOfMonth(sess.startedAt);
  const windowTo = sessionStartIso;

  const [purchasesByIng, lines] = await Promise.all([
    fetchPurchasesByIngredient(outletId, windowFrom, windowTo),
    db
      .select({
        ingredientId: stockOpnameLines.ingredientId,
        unitCostAtSnapshot: stockOpnameLines.unitCostAtSnapshot,
      })
      .from(stockOpnameLines)
      .where(eq(stockOpnameLines.sessionId, sessionId)),
  ]);

  const perIngredient = new Map<string, OpnameLineFlow>();
  for (const l of lines) {
    const openingQty = prior?.qtyByIngredient.get(l.ingredientId) ?? 0;
    const openingUnitCost =
      prior?.costByIngredient.get(l.ingredientId) ?? l.unitCostAtSnapshot;
    const purch = purchasesByIng.get(l.ingredientId);
    perIngredient.set(l.ingredientId, {
      openingQty,
      openingUnitCost,
      purchasesQty: purch?.qty ?? 0,
      purchasesCost: purch?.cost ?? 0,
    });
  }

  return {
    perIngredient,
    hasPriorOpname: prior !== null,
    priorOpnameDate: prior?.finalizedAt
      ? jakartaIsoDate(prior.finalizedAt)
      : null,
    windowFrom,
    windowTo,
  };
}
