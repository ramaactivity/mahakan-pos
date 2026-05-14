/**
 * Sesi AE-57 — Pure helpers untuk Tarik dari PR ke Pembelian. Grouping
 * items per supplier supaya 1 PR bisa di-split jadi N pembelian.
 * No DB / framework deps — testable isolation.
 */

export interface PrPurchaseItemRow {
  purchaseRequestItemId: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  /** Quantity dari sisi PR (sisa outstanding). */
  outstandingQty: number;
  /** Qty yang dipilih staff untuk dibeli. <= outstandingQty. */
  qty: number;
  /** Supplier yang dipilih staff. NULL = belum di-assign. */
  supplierId: string | null;
  /** Harga per unit yang di-input staff. */
  unitCost: number;
  /** Unit override (Pack/Btl/Kg/dll), optional. NULL = pakai master. */
  unitOverride?: string | null;
  /** Selected flag (false = staff uncheck). */
  selected: boolean;
}

export interface PurchaseGroup {
  supplierId: string | null;
  supplierName: string;
  items: PrPurchaseItemRow[];
  itemCount: number;
  totalAmount: number;
}

export interface GroupingOptions {
  supplierNameLookup?: (id: string | null) => string | null;
}

/**
 * Group items by supplierId. Return one group per distinct supplier.
 * Items dengan supplierId=null masuk grup "Tanpa Supplier" (group key null),
 * tidak akan di-submit sampai staff assign supplier.
 *
 * Sort: alphabetical by supplier name. Null group selalu di paling akhir.
 */
export function groupItemsBySupplier(
  items: PrPurchaseItemRow[],
  options: GroupingOptions = {},
): PurchaseGroup[] {
  const lookup = options.supplierNameLookup ?? (() => null);

  // Cuma items yang `selected=true` ikut grup
  const selected = items.filter((i) => i.selected);

  const byKey = new Map<string, PurchaseGroup>();
  for (const item of selected) {
    const key = item.supplierId ?? "__null__";
    if (!byKey.has(key)) {
      const name =
        item.supplierId == null
          ? "Tanpa Supplier"
          : (lookup(item.supplierId) ?? `Supplier ${item.supplierId.slice(0, 8)}`);
      byKey.set(key, {
        supplierId: item.supplierId,
        supplierName: name,
        items: [],
        itemCount: 0,
        totalAmount: 0,
      });
    }
    const grp = byKey.get(key)!;
    grp.items.push(item);
    grp.itemCount++;
    grp.totalAmount += Math.round(item.qty * item.unitCost);
  }

  const groups = Array.from(byKey.values());
  groups.sort((a, b) => {
    if (a.supplierId == null) return 1;
    if (b.supplierId == null) return -1;
    return a.supplierName.localeCompare(b.supplierName);
  });
  return groups;
}

/**
 * Validation result untuk staff sebelum submit. Catat semua issue
 * (bukan throw pertama) supaya UI bisa list seluruh masalah.
 */
export interface ValidationIssue {
  itemId: string;
  field: "supplier" | "qty" | "unitCost";
  message: string;
}

export function validatePurchaseGroupItems(
  items: PrPurchaseItemRow[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const item of items) {
    if (!item.selected) continue;
    if (!item.supplierId) {
      issues.push({
        itemId: item.purchaseRequestItemId,
        field: "supplier",
        message: `${item.ingredientName}: pilih supplier dulu`,
      });
    }
    if (!Number.isFinite(item.qty) || item.qty <= 0) {
      issues.push({
        itemId: item.purchaseRequestItemId,
        field: "qty",
        message: `${item.ingredientName}: qty harus > 0`,
      });
    } else if (item.qty > item.outstandingQty) {
      issues.push({
        itemId: item.purchaseRequestItemId,
        field: "qty",
        message: `${item.ingredientName}: maks ${item.outstandingQty} (sisa outstanding)`,
      });
    }
    if (!Number.isFinite(item.unitCost) || item.unitCost < 0) {
      issues.push({
        itemId: item.purchaseRequestItemId,
        field: "unitCost",
        message: `${item.ingredientName}: harga harus ≥ 0`,
      });
    }
  }
  return issues;
}

/**
 * PR status auto-promote — pure helper di-extract supaya bisa di-share
 * antara createPurchase (PR-linked path) dan receiveItem existing.
 *
 * Status workflow:
 *   - open: ada item dengan receivedQty < requestedQty AND !rejected
 *   - partial: minimal 1 item received > 0 tapi belum semua selesai
 *   - completed: semua items either fully received OR rejected
 */
export type PrStatus = "open" | "partial" | "completed" | "cancelled";

export interface PrItemForStatus {
  requestedQty: number;
  receivedQty: number;
  rejectedAt: Date | null;
}

export function computePrStatus(items: PrItemForStatus[]): PrStatus {
  if (items.length === 0) return "open";
  let hasOutstanding = false;
  let hasReceived = false;
  for (const item of items) {
    const isRejected = item.rejectedAt != null;
    if (isRejected) continue;
    if (item.receivedQty > 0) hasReceived = true;
    if (item.receivedQty < item.requestedQty) hasOutstanding = true;
  }
  if (!hasOutstanding) return "completed";
  if (hasReceived) return "partial";
  return "open";
}
