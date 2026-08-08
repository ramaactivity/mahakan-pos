import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  goodsReceiptItems,
  goodsReceipts,
  purchaseItems,
  purchases,
  suppliers,
  users,
} from "@/db/schema";
import type { IntakeLine, IntakeResult, PendingOrder } from "./intake-pure";

export type { IntakeResult };

/** Cap baris supaya rentang tanggal ngawur tidak menarik megabytes. */
const LINE_CAP = 3000;

export interface ListIntakeOptions {
  /** YYYY-MM-DD (WIB) — filter atas TANGGAL MASUK barang. */
  dateFrom: string;
  dateTo: string;
  ingredientId?: string;
  supplierId?: string;
  /** 'unpaid' = hutang belum lunas saja. */
  paymentStatus?: "all" | "paid" | "unpaid";
}

function toNumber(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? "");
}

/**
 * Sesi AE-192 — daftar penerimaan bahan baku (GR + pembelian instan).
 *
 * Dua sumber digabung karena riwayat prod memuat keduanya:
 *  1. `goods_receipt_items` — alur PR → PO → GR (mayoritas sejak Juni 2026).
 *     Tanggal masuk = `goods_receipts.received_date`.
 *  2. `purchase_items` dari pembelian yang berstatus diterima TAPI tidak punya
 *     baris GR sama sekali (jalur `createPurchase` lama, 8 baris di Mei 2026).
 *     Tanggal masuk = `purchases.purchase_date`.
 *
 * Pembelian batal (status/receipt_status = 'cancelled') dikecualikan — barang
 * batal bukan barang masuk.
 */
export async function fetchIngredientIntake(
  outletId: string,
  opts: ListIntakeOptions,
): Promise<IntakeResult> {
  const { dateFrom, dateTo } = opts;

  const notCancelled = sql`${purchases.status} <> 'cancelled' and ${purchases.receiptStatus} <> 'cancelled'`;

  // ---- Sumber 1: Goods Receipt ------------------------------------------
  const grConds = [
    eq(goodsReceipts.outletId, outletId),
    gte(goodsReceipts.receivedDate, dateFrom),
    lte(goodsReceipts.receivedDate, dateTo),
    notCancelled,
  ];
  if (opts.ingredientId)
    grConds.push(eq(goodsReceiptItems.ingredientId, opts.ingredientId));
  if (opts.supplierId)
    grConds.push(eq(purchases.supplierId, opts.supplierId));
  if (opts.paymentStatus === "paid")
    grConds.push(eq(purchases.status, "paid"));
  if (opts.paymentStatus === "unpaid")
    grConds.push(eq(purchases.status, "pending_payment"));

  const grRows = await db
    .select({
      id: goodsReceiptItems.id,
      receiptDate: goodsReceipts.receivedDate,
      purchaseId: purchases.id,
      purchaseDate: purchases.purchaseDate,
      invoiceNo: purchases.invoiceNo,
      supplierName: suppliers.name,
      ingredientId: goodsReceiptItems.ingredientId,
      ingredientName: goodsReceiptItems.ingredientNameSnapshot,
      unit: goodsReceiptItems.unitSnapshot,
      qty: goodsReceiptItems.receivedQty,
      qtyDecimal: goodsReceiptItems.receivedQtyDecimal,
      unitCost: goodsReceiptItems.unitCost,
      totalCost: goodsReceiptItems.totalCost,
      paymentMethod: purchases.paymentMethod,
      paymentStatus: purchases.status,
      dueDate: purchases.dueDate,
      paidAt: purchases.paidAt,
      enteredAt: goodsReceipts.createdAt,
      enteredByName: users.name,
      receiptImageUrl: purchases.receiptImageUrl,
      receiptImageUrls: purchases.receiptImageUrls,
    })
    .from(goodsReceiptItems)
    .innerJoin(
      goodsReceipts,
      eq(goodsReceipts.id, goodsReceiptItems.goodsReceiptId),
    )
    .innerJoin(purchases, eq(purchases.id, goodsReceipts.purchaseId))
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(users, eq(users.id, goodsReceipts.createdBy))
    .where(and(...grConds))
    .orderBy(desc(goodsReceipts.receivedDate))
    .limit(LINE_CAP + 1);

  // ---- Sumber 2: pembelian instan tanpa GR ------------------------------
  const directConds = [
    eq(purchases.outletId, outletId),
    gte(purchases.purchaseDate, dateFrom),
    lte(purchases.purchaseDate, dateTo),
    notCancelled,
    sql`${purchases.receiptStatus} in ('received', 'partial')`,
    sql`not exists (select 1 from ${goodsReceipts} gr where gr.purchase_id = ${purchases.id})`,
  ];
  if (opts.ingredientId)
    directConds.push(eq(purchaseItems.ingredientId, opts.ingredientId));
  if (opts.supplierId)
    directConds.push(eq(purchases.supplierId, opts.supplierId));
  if (opts.paymentStatus === "paid")
    directConds.push(eq(purchases.status, "paid"));
  if (opts.paymentStatus === "unpaid")
    directConds.push(eq(purchases.status, "pending_payment"));

  const directRows = await db
    .select({
      id: purchaseItems.id,
      receiptDate: purchases.purchaseDate,
      purchaseId: purchases.id,
      purchaseDate: purchases.purchaseDate,
      invoiceNo: purchases.invoiceNo,
      supplierName: suppliers.name,
      ingredientId: purchaseItems.ingredientId,
      ingredientName: purchaseItems.ingredientNameSnapshot,
      unit: sql<string>`coalesce(${purchaseItems.unitOverride}, ${purchaseItems.unitSnapshot})`,
      qty: purchaseItems.qty,
      qtyDecimal: purchaseItems.qtyDecimal,
      unitCost: purchaseItems.unitCost,
      totalCost: purchaseItems.totalCost,
      paymentMethod: purchases.paymentMethod,
      paymentStatus: purchases.status,
      dueDate: purchases.dueDate,
      paidAt: purchases.paidAt,
      enteredAt: purchases.createdAt,
      enteredByName: users.name,
      receiptImageUrl: purchases.receiptImageUrl,
      receiptImageUrls: purchases.receiptImageUrls,
    })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(users, eq(users.id, purchases.createdBy))
    .where(and(...directConds))
    .orderBy(desc(purchases.purchaseDate))
    .limit(LINE_CAP + 1);

  type RawRow = (typeof grRows)[number] | (typeof directRows)[number];
  const mapRow = (r: RawRow, source: "gr" | "direct"): IntakeLine => ({
    id: r.id,
    source,
    receiptDate: String(r.receiptDate),
    purchaseId: r.purchaseId,
    purchaseDate: String(r.purchaseDate),
    invoiceNo: r.invoiceNo,
    supplierName: r.supplierName,
    ingredientId: r.ingredientId,
    ingredientName: r.ingredientName,
    unit: r.unit,
    // Decimal mirror adalah kebenaran qty (0.5 Kg dst); bigint cuma snapshot.
    qty: r.qtyDecimal !== null ? toNumber(r.qtyDecimal) : toNumber(r.qty),
    unitCost: toNumber(r.unitCost),
    totalCost: toNumber(r.totalCost),
    paymentMethod: r.paymentMethod,
    paymentStatus: r.paymentStatus,
    dueDate: r.dueDate ? String(r.dueDate) : null,
    paidAt: r.paidAt ? toIso(r.paidAt) : null,
    enteredAt: toIso(r.enteredAt),
    enteredByName: r.enteredByName,
    hasReceiptPhoto: Boolean(
      r.receiptImageUrl ||
        (Array.isArray(r.receiptImageUrls) && r.receiptImageUrls.length > 0),
    ),
  });

  const truncated =
    grRows.length > LINE_CAP || directRows.length > LINE_CAP;
  const lines = [
    ...grRows.slice(0, LINE_CAP).map((r) => mapRow(r, "gr")),
    ...directRows.slice(0, LINE_CAP).map((r) => mapRow(r, "direct")),
  ];

  return {
    lines,
    pendingOrders: await fetchPendingOrders(outletId, opts),
    truncated,
  };
}

/**
 * PO yang barangnya belum (atau baru sebagian) diterima. Ini sisi lain dari
 * pertanyaan owner: "sudah dipesan tapi belum tercatat masuk". Tidak dibatasi
 * rentang tanggal filter — PO menggantung dari bulan lalu justru yang paling
 * perlu kelihatan; hanya dibatasi supplier kalau filter supplier aktif.
 */
async function fetchPendingOrders(
  outletId: string,
  opts: ListIntakeOptions,
): Promise<PendingOrder[]> {
  const conds = [
    eq(purchases.outletId, outletId),
    sql`${purchases.receiptStatus} in ('ordered', 'partial')`,
    sql`${purchases.status} <> 'cancelled'`,
  ];
  if (opts.supplierId) conds.push(eq(purchases.supplierId, opts.supplierId));

  const rows = await db
    .select({
      purchaseId: purchases.id,
      purchaseDate: purchases.purchaseDate,
      supplierName: suppliers.name,
      invoiceNo: purchases.invoiceNo,
      totalAmount: purchases.totalAmount,
      receiptStatus: purchases.receiptStatus,
      /* Kolom outer WAJIB ditulis literal ber-prefix tabel: di posisi SELECT,
       * Drizzle me-render `${purchases.id}` menjadi `"id"` polos yang lalu
       * ke-tangkap `purchase_items.id` — subquery jadi selalu 0 tanpa error.
       * Alias inner (`pi`) supaya tidak ada nama yang ambigu. */
      itemCount: sql<number>`(
        select count(*)::int from purchase_items pi
        where pi.purchase_id = purchases.id
      )`,
      receivedItemCount: sql<number>`(
        select count(*)::int from purchase_items pi
        where pi.purchase_id = purchases.id
          and pi.received_qty_decimal > 0
      )`,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(and(...conds))
    .orderBy(desc(purchases.purchaseDate))
    .limit(100);

  return rows.map((r) => ({
    purchaseId: r.purchaseId,
    purchaseDate: String(r.purchaseDate),
    supplierName: r.supplierName,
    invoiceNo: r.invoiceNo,
    totalAmount: toNumber(r.totalAmount),
    receiptStatus: r.receiptStatus as "ordered" | "partial",
    itemCount: Number(r.itemCount),
    receivedItemCount: Number(r.receivedItemCount),
  }));
}
