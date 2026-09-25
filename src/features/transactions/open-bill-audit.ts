/**
 * Sesi AE-234 — item-level snapshot for open bill audit logs.
 *
 * editOpenBill hard-deletes the old transaction_items, so the audit log is
 * the ONLY place the pre-edit order survives. Without this a cashier could
 * swap "Pablo 24.000" for "Americano 16.000" and the log only said
 * "1 item → 1 item" (fraud case TRX-20260924-0003).
 */

export interface AuditItemLine {
  name: string;
  qty: number;
  subtotal: number;
}

export interface AuditItemChange {
  name: string;
  qty: number;
}

interface ItemLike {
  itemName: string;
  variant: string | null;
  quantity: number;
  subtotal: number;
}

export function toAuditLines(items: ItemLike[]): AuditItemLine[] {
  return items.map((i) => ({
    name: i.variant ? `${i.itemName} (${i.variant})` : i.itemName,
    qty: i.quantity,
    subtotal: i.subtotal,
  }));
}

/** Net qty change per item name: what disappeared vs what appeared. */
export function diffAuditLines(
  before: AuditItemLine[],
  after: AuditItemLine[],
): { removed: AuditItemChange[]; added: AuditItemChange[] } {
  const net = new Map<string, number>();
  for (const l of before) net.set(l.name, (net.get(l.name) ?? 0) - l.qty);
  for (const l of after) net.set(l.name, (net.get(l.name) ?? 0) + l.qty);
  const removed: AuditItemChange[] = [];
  const added: AuditItemChange[] = [];
  for (const [name, d] of net) {
    if (d < 0) removed.push({ name, qty: -d });
    else if (d > 0) added.push({ name, qty: d });
  }
  return { removed, added };
}

export function formatChanges(changes: AuditItemChange[]): string {
  return changes.map((c) => `${c.qty}× ${c.name}`).join(", ");
}
