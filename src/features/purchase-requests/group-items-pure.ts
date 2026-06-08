/**
 * Sesi AE-57 — Pure helpers untuk Tarik dari PR ke Pembelian. Grouping
 * items per supplier supaya 1 PR bisa di-split jadi N pembelian.
 * No DB / framework deps — testable isolation.
 */

export interface PrPurchaseItemRow {
  purchaseRequestItemId: string;
  ingredientId: string;
  ingredientName: string;
  /** Unit asal dari PR item snapshot (label staff input). */
  unit: string;
  /** Quantity dari sisi PR (sisa outstanding). */
  outstandingQty: number;
  /** Qty yang dipilih staff untuk dibeli. Boleh ≠ outstanding (over /
   * under, sesi AE-122). PR receivedQty di-cap di outstanding side. */
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
 *
 * Sesi AE-122 — `severity`:
 *   - "error" (default): block submit. Mis. supplier kosong, qty <= 0.
 *   - "warning": ditampilkan kuning untuk awareness, TAPI tidak block
 *     submit. Owner punya pertimbangan lain (acara, ramai, salah qty
 *     dari staff).
 *
 * Helper baru `validatePurchaseGroupBlockers()` filter hanya error.
 */
export interface ValidationIssue {
  itemId: string;
  field: "supplier" | "qty" | "unitCost";
  message: string;
  severity: "error" | "warning";
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
        severity: "error",
      });
    }
    if (!Number.isFinite(item.qty) || item.qty <= 0) {
      issues.push({
        itemId: item.purchaseRequestItemId,
        field: "qty",
        message: `${item.ingredientName}: qty harus > 0`,
        severity: "error",
      });
    } else if (item.qty > item.outstandingQty) {
      const delta = item.qty - item.outstandingQty;
      issues.push({
        itemId: item.purchaseRequestItemId,
        field: "qty",
        message: `${item.ingredientName}: lebih ${delta.toLocaleString("id-ID")} dari yang di-request (${item.outstandingQty})`,
        severity: "warning",
      });
    }
    if (!Number.isFinite(item.unitCost) || item.unitCost < 0) {
      issues.push({
        itemId: item.purchaseRequestItemId,
        field: "unitCost",
        message: `${item.ingredientName}: harga harus ≥ 0`,
        severity: "error",
      });
    }
  }
  return issues;
}

/** Hanya issue dengan severity="error" — yang block submit. */
export function getPurchaseGroupBlockers(
  issues: ValidationIssue[],
): ValidationIssue[] {
  return issues.filter((i) => i.severity === "error");
}

/**
 * PR status auto-promote — pure helper di-extract supaya bisa di-share
 * antara createPurchase (PR-linked path) dan receiveItem existing.
 *
 * Keputusan owner (feedback Anisa 2026-06-08): owner BEBAS beli lebih atau
 * KURANG dari request staff ("Owner bebas override request staff" — copy modal
 * Tarik ke Pembelian). Karena itu qty kurang dari request = keputusan FINAL
 * owner, BUKAN sisa yang masih ditunggu. Sebuah item dianggap "outstanding"
 * HANYA kalau belum dibeli sama sekali (receivedQty == 0). Item yang sengaja
 * di-skip total ditutup owner via tombol "Tandai Selesai" (markPurchaseRequestComplete).
 *
 * Status workflow:
 *   - open: belum ada item yang diterima sama sekali
 *   - partial: sebagian item sudah diterima, masih ada item yg belum dibeli (qty 0)
 *   - completed: SEMUA item non-rejected sudah diterima (≥1 unit; qty kurang OK)
 */
export type PrStatus = "open" | "partial" | "completed" | "cancelled";

export interface PrItemForStatus {
  requestedQty: number;
  receivedQty: number;
  rejectedAt: Date | null;
}

export function computePrStatus(items: PrItemForStatus[]): PrStatus {
  if (items.length === 0) return "open";
  let hasOutstanding = false; // ada item yg belum dibeli sama sekali (qty 0)
  let hasReceived = false;
  let activeCount = 0;
  for (const item of items) {
    const isRejected = item.rejectedAt != null;
    if (isRejected) continue;
    activeCount++;
    if (item.receivedQty > 0) hasReceived = true;
    else hasOutstanding = true; // receivedQty == 0 → belum dibeli
  }
  if (activeCount === 0) return "open"; // semua item rejected → caller bisa override ke cancelled
  if (!hasOutstanding) return "completed"; // semua item sudah dapat ≥1 unit (qty kurang = final owner)
  if (hasReceived) return "partial";
  return "open";
}
