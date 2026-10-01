import "server-only";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  customers,
  shifts,
  splitPayments,
  transactionItems,
  transactions,
  users,
} from "@/db/schema";
import { toAuditLines } from "@/features/transactions/open-bill-audit";
import {
  findMoveCandidates,
  type BillDetail,
  type BillReduction,
  type BillTrailStep,
  type DetailItemChange,
  type DetailItemLine,
  type InflowEvent,
} from "./bill-detail-pure";

/* Audit payloads are untyped JSON; read defensively. */
type Json = Record<string, unknown> | null | undefined;
const obj = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
function lines(v: unknown): DetailItemLine[] | null {
  if (!Array.isArray(v)) return null;
  return v.map((l) => ({
    name: String(obj(l)?.name ?? "?"),
    qty: Number(obj(l)?.qty ?? 0),
    subtotal: Number(obj(l)?.subtotal ?? 0),
  }));
}
function changes(v: unknown): DetailItemChange[] | null {
  if (!Array.isArray(v)) return null;
  return v.map((l) => ({ name: String(obj(l)?.name ?? "?"), qty: Number(obj(l)?.qty ?? 0) }));
}
const KIND: Record<string, string> = {
  "transaction.open_bill.create": "create",
  "transaction.open_bill.edit": "edit",
  "transaction.open_bill.close": "close",
  "transaction.open_bill.cancel": "cancel",
  "transaction.split_payment.add": "split",
  "transaction.reprint": "reprint",
};

const crewNameSql = (col: string) =>
  sql<string | null>`(select coalesce(nullif(trim(e.nickname), ''), e.full_name) from employees e where e.id = "transactions".${sql.raw(`"${col}"`)})`;

export async function fetchBillDetail(
  outletId: string,
  transactionId: string,
): Promise<BillDetail | null> {
  const [t] = await db
    .select({
      id: transactions.id,
      transactionNumber: transactions.transactionNumber,
      status: transactions.status,
      shiftId: transactions.shiftId,
      createdAt: transactions.createdAt,
      customerName: transactions.customerName,
      customerMasterName: customers.name,
      paymentMethod: transactions.paymentMethod,
      total: transactions.total,
      discountAmount: transactions.discountAmount,
      discountReason: transactions.discountReason,
      cashReceived: transactions.cashReceived,
      cashChange: transactions.cashChange,
      cashierName: users.name,
      openedCrew: crewNameSql("opened_crew_id"),
      paidCrew: crewNameSql("paid_crew_id"),
    })
    .from(transactions)
    .leftJoin(users, eq(users.id, transactions.cashierId))
    .leftJoin(customers, eq(customers.id, transactions.customerId))
    .where(and(eq(transactions.id, transactionId), eq(transactions.outletId, outletId)))
    .limit(1);
  if (!t) return null;

  const [itemRows, eventRows, splitRows, shiftRow] = await Promise.all([
    db
      .select({
        itemName: transactionItems.itemName,
        variant: transactionItems.variant,
        quantity: transactionItems.quantity,
        subtotal: transactionItems.subtotal,
      })
      .from(transactionItems)
      .where(eq(transactionItems.transactionId, t.id)),
    db
      .select({
        at: auditLogs.createdAt,
        eventType: auditLogs.eventType,
        payload: auditLogs.payload,
        metadata: auditLogs.metadata,
        actorName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(and(eq(auditLogs.entityType, "transaction"), eq(auditLogs.entityId, t.id)))
      .orderBy(asc(auditLogs.createdAt)),
    db
      .select({
        paymentMethod: splitPayments.paymentMethod,
        amount: splitPayments.amount,
        at: splitPayments.createdAt,
      })
      .from(splitPayments)
      .where(eq(splitPayments.transactionId, t.id)),
    t.shiftId
      ? db
          .select({ openedAt: shifts.openedAt, closedAt: shifts.closedAt, variance: shifts.variance })
          .from(shifts)
          .where(eq(shifts.id, t.shiftId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const trail: BillTrailStep[] = eventRows.map((e) => {
    const p = obj(e.payload);
    const ctx = obj(p?.context);
    const before = obj(p?.before);
    const after = obj(p?.after);
    const kind = KIND[e.eventType] ?? "other";
    return {
      at: e.at.toISOString(),
      eventType: e.eventType,
      kind,
      actorName: e.actorName,
      crewName: str(obj(obj(e.metadata)?.crew)?.name),
      totalBefore: num(before?.total),
      totalAfter: num(after?.total) ?? num(ctx?.total),
      items: lines(after?.items) ?? lines(ctx?.items),
      removed: changes(ctx?.removed),
      added: changes(ctx?.added),
      reason: str(ctx?.reason),
      summary: str(p?.summary) ?? e.eventType,
    };
  });

  /* Edit turun → cari ke mana selisihnya pergi, di shift yang sama. */
  const downs = trail.filter(
    (s) => s.kind === "edit" && s.totalBefore !== null && s.totalAfter !== null && s.totalAfter < s.totalBefore,
  );
  let reductions: BillReduction[] = [];
  if (downs.length > 0 && t.shiftId) {
    const inflows = await fetchShiftInflows(t.shiftId, t.id);
    reductions = downs.map((s) => {
      const amount = s.totalBefore! - s.totalAfter!;
      const { candidates, verdict } = findMoveCandidates(
        { at: s.at, amount, totalBefore: s.totalBefore!, removed: s.removed },
        inflows,
      );
      return {
        at: s.at,
        totalBefore: s.totalBefore!,
        totalAfter: s.totalAfter!,
        amount,
        removed: s.removed,
        added: s.added,
        candidates,
        verdict,
      };
    });
  }

  const create = trail.find((s) => s.kind === "create");
  const createCtx = obj(obj(eventRows.find((e) => KIND[e.eventType] === "create")?.payload)?.context);
  const close = trail.find((s) => s.kind === "close");

  return {
    transactionId: t.id,
    transactionNumber: t.transactionNumber,
    status: t.status,
    customerName: t.customerMasterName ?? t.customerName,
    openedAt: t.createdAt.toISOString(),
    paidAt: close?.at ?? null,
    paymentMethod: t.paymentMethod,
    total: Number(t.total),
    discountAmount: Number(t.discountAmount),
    discountReason: t.discountReason,
    cashReceived: t.cashReceived === null ? null : Number(t.cashReceived),
    cashChange: t.cashChange === null ? null : Number(t.cashChange),
    cashierName: t.cashierName,
    openedCrew: t.openedCrew,
    paidCrew: t.paidCrew,
    items: toAuditLines(itemRows.map((i) => ({ ...i, subtotal: Number(i.subtotal) }))),
    initial: create
      ? {
          at: create.at,
          total: create.totalAfter ?? 0,
          itemCount: num(createCtx?.itemCount),
          items: create.items,
        }
      : null,
    trail,
    reductions,
    splitPayments: splitRows.map((s) => ({
      paymentMethod: s.paymentMethod,
      amount: Number(s.amount),
      at: s.at.toISOString(),
    })),
    shift: shiftRow[0]
      ? {
          openedAt: shiftRow[0].openedAt.toISOString(),
          closedAt: shiftRow[0].closedAt?.toISOString() ?? null,
          variance: shiftRow[0].variance,
        }
      : null,
  };
}

/** Semua "uang/item masuk" ke bill LAIN di shift ini: bill baru, edit naik,
 * dan transaksi langsung (yang tidak punya event open bill). */
async function fetchShiftInflows(shiftId: string, excludeId: string): Promise<InflowEvent[]> {
  const others = await db
    .select({
      id: transactions.id,
      transactionNumber: transactions.transactionNumber,
      customerName: transactions.customerName,
      status: transactions.status,
      total: transactions.total,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(and(eq(transactions.shiftId, shiftId), ne(transactions.id, excludeId)));
  if (others.length === 0) return [];
  const ids = others.map((o) => o.id);
  const [events, items] = await Promise.all([
    db
      .select({
        id: auditLogs.entityId,
        at: auditLogs.createdAt,
        eventType: auditLogs.eventType,
        payload: auditLogs.payload,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "transaction"),
          inArray(auditLogs.entityId, ids),
          inArray(auditLogs.eventType, ["transaction.open_bill.create", "transaction.open_bill.edit"]),
        ),
      ),
    db
      .select({
        transactionId: transactionItems.transactionId,
        itemName: transactionItems.itemName,
        variant: transactionItems.variant,
        quantity: transactionItems.quantity,
        subtotal: transactionItems.subtotal,
      })
      .from(transactionItems)
      .where(inArray(transactionItems.transactionId, ids)),
  ]);

  const byId = new Map(others.map((o) => [o.id, o]));
  const openBillIds = new Set<string>();
  const out: InflowEvent[] = [];
  for (const e of events) {
    const o = e.id ? byId.get(e.id) : undefined;
    if (!o) continue;
    openBillIds.add(o.id);
    const p = obj(e.payload);
    const ctx = obj(p?.context);
    const base = {
      transactionId: o.id,
      transactionNumber: o.transactionNumber,
      customerName: o.customerName,
      status: o.status,
      at: e.at.toISOString(),
    };
    if (e.eventType === "transaction.open_bill.create") {
      const total = num(ctx?.total);
      if (total === null) continue;
      const its = lines(ctx?.items);
      out.push({ ...base, kind: "new_bill", amount: total, items: its?.map(({ name, qty }) => ({ name, qty })) ?? null });
    } else {
      const b = num(obj(p?.before)?.total);
      const a = num(obj(p?.after)?.total);
      if (b === null || a === null || a <= b) continue;
      out.push({ ...base, kind: "edit_up", amount: a - b, items: changes(ctx?.added) });
    }
  }
  const itemsByTrx = new Map<string, DetailItemChange[]>();
  for (const i of items) {
    const list = itemsByTrx.get(i.transactionId) ?? [];
    list.push({ name: i.variant ? `${i.itemName} (${i.variant})` : i.itemName, qty: i.quantity });
    itemsByTrx.set(i.transactionId, list);
  }
  for (const o of others) {
    if (openBillIds.has(o.id) || o.status === "voided") continue;
    out.push({
      transactionId: o.id,
      transactionNumber: o.transactionNumber,
      customerName: o.customerName,
      status: o.status,
      at: o.createdAt.toISOString(),
      kind: "direct_sale",
      amount: Number(o.total),
      items: itemsByTrx.get(o.id) ?? [],
    });
  }
  return out;
}
