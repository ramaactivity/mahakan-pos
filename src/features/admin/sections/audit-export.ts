/**
 * Sesi AE-234 — audit log export rows (Excel/CSV).
 *
 * The old CSV dumped UTC ISO timestamps + raw JSON, unreadable for tracking
 * a cashier. This flattens the fields owners actually cross-check against
 * CCTV: WIB time, transaction number, total before/after, item names,
 * cash received/change. Remaining payload keys go into "Detail" as
 * `key: value` text instead of JSON.
 */
import type { AuditLogRow } from "@/lib/audit";
import type { ExportRow, ExportSheet } from "./reports/report-export";

type Obj = Record<string, unknown>;

const asObj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const num = (v: unknown): number | null =>
  typeof v === "number" ? v : null;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Items are logged as {name, qty, subtotal}[] since AE-234; older rows lack them. */
function itemsText(v: unknown): string {
  if (!Array.isArray(v)) return "";
  return v
    .map((i) => {
      const o = asObj(i);
      return `${o.qty ?? "?"}× ${str(o.name)}`;
    })
    .join(", ");
}

function detailText(o: Obj, skip: Set<string>): string {
  return Object.entries(o)
    .filter(([k, v]) => !skip.has(k) && v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("; ");
}

const HANDLED = new Set([
  "transactionNumber",
  "total",
  "paymentMethod",
  "cashReceived",
  "cashChange",
  "items",
  "removed",
  "added",
  "totalDelta",
]);

function wib(d: Date | string, part: "date" | "time"): string {
  return new Date(d).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    ...(part === "date"
      ? { day: "2-digit", month: "2-digit", year: "numeric" }
      : { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  });
}

export function auditLogToExportRow(r: AuditLogRow): ExportRow {
  const p = asObj(r.payload);
  const ctx = asObj(p.context);
  const before = asObj(p.before);
  const after = asObj(p.after);
  const totalBefore = num(before.total);
  const totalAfter = num(after.total) ?? num(ctx.total);
  const changes = (v: unknown) =>
    Array.isArray(v)
      ? v.map((c) => `${asObj(c).qty}× ${str(asObj(c).name)}`).join(", ")
      : "";
  return {
    Tanggal: wib(r.createdAt, "date"),
    "Jam (WIB)": wib(r.createdAt, "time"),
    Event: r.eventType,
    Pelaku: r.userName ?? "",
    Role: r.userRole ?? "",
    Approver: r.approverName ?? "",
    "No. Transaksi": str(ctx.transactionNumber),
    Customer: str(after.customerName) || str(before.customerName),
    Ringkasan: str(p.summary),
    "Total Sebelum": totalBefore,
    "Total Sesudah": totalAfter,
    Selisih:
      totalBefore !== null && totalAfter !== null ? totalAfter - totalBefore : null,
    "Item Sebelum": itemsText(before.items),
    "Item Sesudah": itemsText(after.items) || itemsText(ctx.items),
    "Item Dihapus": changes(ctx.removed),
    "Item Ditambah": changes(ctx.added),
    "Metode Bayar": str(ctx.paymentMethod),
    "Uang Diterima": num(ctx.cashReceived),
    Kembalian: num(ctx.cashChange),
    Detail: [detailText(ctx, HANDLED), p.diff ? `diff: ${JSON.stringify(p.diff)}` : ""]
      .filter(Boolean)
      .join("; "),
    "Entity ID": r.entityId ?? "",
  };
}

/**
 * Sheet 1 = full log, oldest first (reads like a timeline).
 * Sheet 2 = only open bill edits that LOWERED the total — the fraud pattern.
 */
export function buildAuditSheets(rows: AuditLogRow[]): ExportSheet[] {
  const chronological = [...rows].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const all = chronological.map(auditLogToExportRow);
  const reduced = all.filter(
    (r) =>
      r.Event === "transaction.open_bill.edit" &&
      typeof r.Selisih === "number" &&
      r.Selisih < 0,
  );
  return [
    { name: "Audit Log", rows: all },
    ...(reduced.length > 0 ? [{ name: "Bill Diedit Turun", rows: reduced }] : []),
  ];
}
