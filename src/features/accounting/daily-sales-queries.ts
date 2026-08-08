import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  splitPayments,
  transactionItems,
  transactions,
} from "@/db/schema";
import { wibDayRangeUtc } from "@/lib/date";
import type {
  DailyComplimentAggregate,
  DailyPaymentTotal,
  DailySalesAggregate,
  SettleMethod,
} from "./daily-sales-pure";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = DbTx | typeof db;

/** Status transaksi yang ikut dijurnal sebagai penjualan. */
const JOURNALED_STATUS = sql`in ('paid', 'partially_refunded')`;

/**
 * Compliment ditandai lewat prefix `discount_reason`. Sama persis dengan
 * pengecekan di `postJournalForPosSale` supaya satu transaksi tidak pernah
 * masuk dua batch sekaligus.
 */
const COMPLIMENT_PREDICATE = sql`coalesce(${transactions.discountReason}, '') like 'Compliment:%'`;

const VALID_SETTLE_METHODS: readonly SettleMethod[] = [
  "cash",
  "qris",
  "card_bca",
  "card_bni",
  "card_mandiri",
  "card_bri",
  "card_other",
];

export class DailyQueryError extends Error {}

function assertSettleMethod(value: string, context: string): SettleMethod {
  if ((VALID_SETTLE_METHODS as readonly string[]).includes(value)) {
    return value as SettleMethod;
  }
  /* Sama alasannya dengan AE-47 di jurnal per-transaksi: JANGAN diam-diam
   * membuang metode bayar yang tak dikenal — nilainya hilang dari jurnal dan
   * buku besar kurang catat tanpa ada yang tahu. */
  throw new DailyQueryError(
    `DAILY_SALES_INVALID_PAYMENT_METHOD:${value} (${context})`,
  );
}

/**
 * Sesi AE-193 — kumpulkan penjualan satu hari kalender WIB.
 *
 * Rentangnya dihitung sebagai batas UTC (`wibDayRangeUtc`) supaya index
 * `created_at` yang sudah ada tetap terpakai; memfilter dengan
 * `(created_at AT TIME ZONE 'Asia/Jakarta')::date` akan memaksa seq scan.
 */
export async function fetchDailySalesAggregate(
  outletId: string,
  entryDate: string,
  conn: DbOrTx = db,
): Promise<DailySalesAggregate> {
  const { from, to } = wibDayRangeUtc(entryDate);
  const inDay = and(
    eq(transactions.outletId, outletId),
    gte(transactions.createdAt, new Date(from)),
    lte(transactions.createdAt, new Date(to)),
    sql`${transactions.status} ${JOURNALED_STATUS}`,
    sql`not ${COMPLIMENT_PREDICATE}`,
  );

  const [header] = await conn
    .select({
      transactionCount: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${transactions.total}), 0)::bigint`,
      subtotal: sql<number>`coalesce(sum(${transactions.subtotal}), 0)::bigint`,
      discountAmount: sql<number>`coalesce(sum(${transactions.discountAmount}), 0)::bigint`,
    })
    .from(transactions)
    .where(inDay);

  /* Metode bayar tunggal. Transaksi 'split' sengaja dikecualikan di sini —
   * nilainya diambil utuh dari split_payments di query berikutnya, kalau ikut
   * dihitung dua-duanya kasnya jadi dobel. */
  const singleRows = await conn
    .select({
      paymentMethod: transactions.paymentMethod,
      amount: sql<number>`coalesce(sum(${transactions.total}), 0)::bigint`,
    })
    .from(transactions)
    .where(and(inDay, sql`${transactions.paymentMethod} <> 'split'`))
    .groupBy(transactions.paymentMethod);

  const splitRows = await conn
    .select({
      paymentMethod: splitPayments.paymentMethod,
      amount: sql<number>`coalesce(sum(${splitPayments.amount}), 0)::bigint`,
    })
    .from(splitPayments)
    .innerJoin(
      transactions,
      eq(transactions.id, splitPayments.transactionId),
    )
    .where(and(inDay, eq(transactions.paymentMethod, "split")))
    .groupBy(splitPayments.paymentMethod);

  const byMethod = new Map<SettleMethod, number>();
  for (const row of singleRows) {
    const method = assertSettleMethod(
      String(row.paymentMethod),
      `transaksi ${entryDate}`,
    );
    byMethod.set(method, (byMethod.get(method) ?? 0) + Number(row.amount));
  }
  for (const row of splitRows) {
    const method = assertSettleMethod(
      String(row.paymentMethod),
      `split ${entryDate}`,
    );
    byMethod.set(method, (byMethod.get(method) ?? 0) + Number(row.amount));
  }
  const payments: DailyPaymentTotal[] = Array.from(byMethod.entries())
    .map(([paymentMethod, amount]) => ({ paymentMethod, amount }))
    .sort((a, b) => a.paymentMethod.localeCompare(b.paymentMethod));

  const categories = await fetchCategoryTotals(conn, inDay);

  return {
    entryDate,
    outletId,
    transactionCount: Number(header?.transactionCount ?? 0),
    total: Number(header?.total ?? 0),
    subtotal: Number(header?.subtotal ?? 0),
    discountAmount: Number(header?.discountAmount ?? 0),
    payments,
    categories,
  };
}

/** Compliment satu hari — hanya butuh HPP per kategori (tanpa pendapatan). */
export async function fetchDailyComplimentAggregate(
  outletId: string,
  entryDate: string,
  conn: DbOrTx = db,
): Promise<DailyComplimentAggregate> {
  const { from, to } = wibDayRangeUtc(entryDate);
  const inDay = and(
    eq(transactions.outletId, outletId),
    gte(transactions.createdAt, new Date(from)),
    lte(transactions.createdAt, new Date(to)),
    sql`${transactions.status} ${JOURNALED_STATUS}`,
    COMPLIMENT_PREDICATE,
  );

  const [header] = await conn
    .select({ transactionCount: sql<number>`count(*)::int` })
    .from(transactions)
    .where(inDay);

  return {
    entryDate,
    outletId,
    transactionCount: Number(header?.transactionCount ?? 0),
    categories: await fetchCategoryTotals(conn, inDay),
  };
}

async function fetchCategoryTotals(
  conn: DbOrTx,
  inDay: ReturnType<typeof and>,
) {
  const rows = await conn
    .select({
      itemCategoryName: transactionItems.itemCategoryName,
      amount: sql<number>`coalesce(sum(${transactionItems.subtotal}), 0)::bigint`,
      cogs: sql<number>`coalesce(sum(coalesce(${transactionItems.cogs}, 0)), 0)::bigint`,
    })
    .from(transactionItems)
    .innerJoin(
      transactions,
      eq(transactions.id, transactionItems.transactionId),
    )
    .where(inDay)
    .groupBy(transactionItems.itemCategoryName);

  return rows
    .map((r) => ({
      itemCategoryName: r.itemCategoryName,
      amount: Number(r.amount),
      cogs: Number(r.cogs),
    }))
    .sort((a, b) => a.itemCategoryName.localeCompare(b.itemCategoryName));
}

/**
 * Tanggal-tanggal WIB yang punya transaksi terjurnal dalam rentang tertentu.
 * Dipakai sapuan berkala untuk mencari hari yang batch-nya belum dibuat.
 */
export async function fetchDatesWithSales(
  outletId: string,
  fromDate: string,
  toDate: string,
): Promise<string[]> {
  const { from } = wibDayRangeUtc(fromDate);
  const { to } = wibDayRangeUtc(toDate);
  const rows = await db
    .select({
      day: sql<string>`to_char((${transactions.createdAt} at time zone 'Asia/Jakarta')::date, 'YYYY-MM-DD')`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.outletId, outletId),
        gte(transactions.createdAt, new Date(from)),
        lte(transactions.createdAt, new Date(to)),
        sql`${transactions.status} ${JOURNALED_STATUS}`,
      ),
    )
    .groupBy(
      sql`(${transactions.createdAt} at time zone 'Asia/Jakarta')::date`,
    );

  return rows.map((r) => String(r.day)).sort();
}

/**
 * Apakah masih ada shift TERBUKA yang menyentuh tanggal ini? Kalau ya, batch
 * hariannya belum final — tunda supaya tidak perlu dihitung ulang berkali-kali
 * dalam satu hari.
 */
export async function hasOpenShiftOnDate(
  outletId: string,
  entryDate: string,
): Promise<boolean> {
  const { to } = wibDayRangeUtc(entryDate);
  const rows = await db.execute(sql`
    select 1 from shifts s
    where s.outlet_id = ${outletId}
      and s.status = 'open'
      and s.opened_at <= ${to}
    limit 1
  `);
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  return Array.isArray(list) && list.length > 0;
}
