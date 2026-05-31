/**
 * Pure (no-DB) helpers for transaction inventory flow — unit-testable.
 *
 * Sesi AE-173 — COGS resolution: HPP manual menang kalau diisi.
 */

export interface ResolveLineCogsInput {
  /** menu_items.cost — HPP manual per unit (Rp). null = belum diisi. */
  manualCostPerUnit: number | null;
  /** COGS dari resep untuk seluruh baris (sudah waste-applied + scaled qty + rounded). */
  recipeLineCogs: number;
  quantity: number;
}

export interface ResolveLineCogsResult {
  lineCogs: number;
  usedManual: boolean;
}

/**
 * Tentukan COGS satu baris transaksi.
 *
 * Aturan (AE-173): kalau `manualCostPerUnit` diisi (>= 0) → pakai itu,
 * `cost × quantity`, TANPA waste factor (HPP manual = biaya all-in versi owner).
 * Kalau null → pakai `recipeLineCogs` (perilaku lama, waste sudah termasuk).
 *
 * Catatan: manual cost hanya mengubah ANGKA COGS, tidak pernah mengubah qty
 * deduksi stok (di mode perpetual, deduksi tetap dari resep).
 */
export function resolveLineCogs(
  input: ResolveLineCogsInput,
): ResolveLineCogsResult {
  const { manualCostPerUnit, recipeLineCogs, quantity } = input;
  if (manualCostPerUnit != null && manualCostPerUnit >= 0) {
    return {
      lineCogs: Math.round(manualCostPerUnit * quantity),
      usedManual: true,
    };
  }
  return { lineCogs: recipeLineCogs, usedManual: false };
}
