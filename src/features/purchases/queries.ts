import "server-only";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  expenses,
  ingredients,
  purchaseItems,
  purchases,
  suppliers,
  users,
} from "@/db/schema";
import {
  resolveQtyToMaster,
  type IngredientPackConversion,
} from "@/lib/unit-conversion";
import { clampFromDate, getCutoffDate } from "@/features/cutoff/cutoff";
import type {
  ListPurchasesOptions,
  PaymentMethod,
  Purchase,
  PurchaseDetail,
  PurchaseListItem,
  TopHistoryItem,
  TopHistoryOptions,
  TopHistoryStatus,
  TopHistorySummary,
  TopOutstandingItem,
} from "./types";

const LIMIT_CAP = 1000;

export async function fetchPurchases(
  outletId: string,
  opts: ListPurchasesOptions = {},
): Promise<PurchaseListItem[]> {
  const limit = Math.min(opts.limit ?? 100, LIMIT_CAP);
  const offset = opts.offset ?? 0;

  const conds = [eq(purchases.outletId, outletId)];
  if (opts.status) conds.push(eq(purchases.status, opts.status));
  if (opts.supplierId)
    conds.push(eq(purchases.supplierId, opts.supplierId));
  if (opts.paymentMethod)
    conds.push(eq(purchases.paymentMethod, opts.paymentMethod));
  // Sesi AE-207 — daftar Pembelian mulai dari batas buku.
  const cutoff = await getCutoffDate(outletId);
  const dateFrom = clampFromDate(opts.dateFrom, cutoff);

  /**
   * Sesi AE-219b — PO yang masih TERBUKA tidak ikut disembunyikan.
   *
   * Aturannya sudah dipakai riwayat hutang TOP sejak AE-207 ("hutang hidup
   * tidak boleh disembunyikan, yang disembunyikan hanya riwayat yang sudah
   * beres") — tapi daftar Pembelian belum ikut, sehingga PO Cargloss 25 Juni
   * yang belum diterima DAN belum lunas lenyap di balik batas buku 1 Juli.
   * Tidak ada error, tidak ada tanda: pesanannya sekadar tidak pernah muncul
   * lagi, jadi tidak pernah bisa diselesaikan.
   *
   * "Terbuka" = belum diterima (ordered/partial) ATAU belum lunas. Yang sudah
   * diterima dan sudah lunas tetap tersembunyi — itu memang riwayat.
   */
  const stillOpen = sql`(${purchases.receiptStatus} IN ('ordered','partial')
      OR ${purchases.status} = 'pending_payment')`;

  /* Batas bawah tanggal yang BERLAKU untuk owner: filter yang dia ketik, atau
   * batas buku kalau dia tidak memfilter. Dipakai juga untuk menandai baris
   * yang muncul dari luar rentang. */
  const effectiveFrom = opts.dateFrom ?? cutoff;
  /* Lantainya datang dari batas buku, bukan dari filter yang diketik owner? */
  const flooredByCutoff =
    cutoff !== null && (!opts.dateFrom || opts.dateFrom < cutoff);

  const rangeConds = [];
  if (dateFrom) rangeConds.push(gte(purchases.purchaseDate, dateFrom));
  if (opts.dateTo) rangeConds.push(lte(purchases.purchaseDate, opts.dateTo));

  if (rangeConds.length > 0) {
    /* PO terbuka boleh menembus rentang kalau (a) lantainya cuma batas buku —
     * kalau tidak, pesanannya lenyap selamanya, atau (b) pemanggil memang
     * minta (tab PO sebagai daftar kerja). Filter tanggal yang diketik owner
     * sendiri tidak ditembus diam-diam: kasus (b) menandai barisnya. */
    const openMayBypass = opts.includeOpenOutsideRange === true || flooredByCutoff;
    if (openMayBypass) {
      /* Sisi atas tetap dihormati — pesanan bertanggal setelah rentang tidak
       * ikut melompat masuk. */
      const openSide = opts.dateTo
        ? sql`(${stillOpen} AND ${purchases.purchaseDate} <= ${opts.dateTo})`
        : stillOpen;
      conds.push(sql`(${and(...rangeConds)} OR ${openSide})`);
    } else {
      conds.push(...rangeConds);
    }
  }

  const rows = await db
    .select({
      purchase: purchases,
      supplierName: suppliers.name,
      /* Sesi AE-192 — kolom outer WAJIB literal ber-prefix tabel. Versi lama
       * memakai `${purchases.id}` yang di posisi SELECT di-render `"id"` polos
       * lalu ke-tangkap `purchase_items.id`, jadi kolom "Item" di daftar
       * Pembelian selalu 0 (diam, tanpa error). */
      itemCount: sql<number>`(
        select count(*)::int from purchase_items pi
        where pi.purchase_id = purchases.id
      )`,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(and(...conds))
    .orderBy(desc(purchases.purchaseDate), desc(purchases.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    ...r.purchase,
    supplierName: r.supplierName,
    itemCount: r.itemCount,
    /* Muncul karena masih terbuka, bukan karena masuk rentang yang dipilih. */
    outsideRange: Boolean(
      effectiveFrom && String(r.purchase.purchaseDate) < effectiveFrom,
    ),
  }));
}

export async function fetchPurchaseDetail(
  id: string,
  outletId: string,
): Promise<PurchaseDetail | null> {
  const [headerRow] = await db
    .select({
      purchase: purchases,
      supplierName: suppliers.name,
      createdByName: users.name,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(users, eq(users.id, purchases.createdBy))
    .where(
      and(eq(purchases.id, id), eq(purchases.outletId, outletId)),
    )
    .limit(1);
  if (!headerRow) return null;

  // Resolve actor names for paid_by / cancelled_by.
  const userIds = new Set<string>();
  if (headerRow.purchase.paidBy) userIds.add(headerRow.purchase.paidBy);
  if (headerRow.purchase.cancelledBy)
    userIds.add(headerRow.purchase.cancelledBy);
  const nameById = new Map<string, string>();
  if (userIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, Array.from(userIds)));
    for (const u of userRows) nameById.set(u.id, u.name);
  }

  const itemRows = await db
    .select({
      item: purchaseItems,
      currentUnit: ingredients.unit,
      currentSection: ingredients.section,
    })
    .from(purchaseItems)
    .innerJoin(
      ingredients,
      eq(ingredients.id, purchaseItems.ingredientId),
    )
    .where(eq(purchaseItems.purchaseId, id))
    .orderBy(purchaseItems.ingredientNameSnapshot);

  return {
    ...headerRow.purchase,
    supplierName: headerRow.supplierName,
    createdByName: headerRow.createdByName,
    paidByName: headerRow.purchase.paidBy
      ? nameById.get(headerRow.purchase.paidBy) ?? null
      : null,
    cancelledByName: headerRow.purchase.cancelledBy
      ? nameById.get(headerRow.purchase.cancelledBy) ?? null
      : null,
    items: itemRows.map((r) => ({
      ...r.item,
      currentUnit: r.currentUnit,
      currentSection: r.currentSection,
    })),
  };
}

/**
 * Hutang TOP yang belum lunas.
 *
 * ⚠️ Sesi AE-207 — SENGAJA TIDAK ikut batas buku. Arahan owner: hutang &
 * hutang dagang DIPERTAHANKAN. Nota yang belum dibayar tidak boleh hilang dari
 * layar cuma karena tanggalnya sebelum cutoff — itu kewajiban yang masih
 * hidup. Yang disembunyikan hanya RIWAYAT yang sudah lunas/batal
 * (lihat `fetchTopHistory`).
 */
export async function fetchTopOutstanding(
  outletId: string,
  todayIso: string,
): Promise<TopOutstandingItem[]> {
  const rows = await db
    .select({
      purchase: purchases,
      supplierName: suppliers.name,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(
      and(
        eq(purchases.outletId, outletId),
        eq(purchases.status, "pending_payment"),
      ),
    )
    .orderBy(purchases.dueDate);

  return rows.map((r) => {
    const due = r.purchase.dueDate;
    let daysToDue: number | null = null;
    if (due) {
      const today = Date.parse(todayIso + "T00:00:00Z");
      const dueAt = Date.parse(due + "T00:00:00Z");
      daysToDue = Math.round((dueAt - today) / (1000 * 60 * 60 * 24));
    }
    return {
      id: r.purchase.id,
      purchaseDate: r.purchase.purchaseDate,
      supplierId: r.purchase.supplierId,
      supplierName: r.supplierName,
      invoiceNo: r.purchase.invoiceNo,
      totalAmount: r.purchase.totalAmount,
      dueDate: due,
      daysToDue,
    };
  });
}

/**
 * Aggregate purchase totals grouped by date × section × payment_method.
 * Used by purchase rollup report (replaces Owner's `Rekap Inv Detail` pivot).
 */
export async function fetchPurchaseRollup(
  outletId: string,
  dateFrom: string,
  dateTo: string,
): Promise<
  Array<{
    purchaseDate: string;
    section: string | null;
    paymentMethod: PaymentMethod;
    totalAmount: number;
  }>
> {
  const rows = await db
    .select({
      purchaseDate: purchases.purchaseDate,
      section: purchaseItems.sectionSnapshot,
      paymentMethod: purchases.paymentMethod,
      totalAmount: sql<number>`coalesce(sum(${purchaseItems.totalCost}), 0)::bigint`,
    })
    .from(purchases)
    .innerJoin(
      purchaseItems,
      eq(purchaseItems.purchaseId, purchases.id),
    )
    .where(
      and(
        eq(purchases.outletId, outletId),
        sql`${purchases.status} != 'cancelled'`,
        // Sesi AE-207 — rekap pembelian ikut batas buku.
        gte(
          purchases.purchaseDate,
          clampFromDate(dateFrom, await getCutoffDate(outletId)) as string,
        ),
        lte(purchases.purchaseDate, dateTo),
      ),
    )
    .groupBy(
      purchases.purchaseDate,
      purchaseItems.sectionSnapshot,
      purchases.paymentMethod,
    )
    .orderBy(purchases.purchaseDate);

  return rows.map((r) => ({
    purchaseDate: r.purchaseDate,
    section: r.section,
    paymentMethod: r.paymentMethod,
    totalAmount: Number(r.totalAmount),
  }));
}

export async function fetchPurchaseById(
  id: string,
  outletId: string,
): Promise<Purchase | null> {
  const [row] = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, id), eq(purchases.outletId, outletId)))
    .limit(1);
  return row ?? null;
}

export interface PurchaseQtyByIngredient {
  /** Qty dalam SATUAN DASAR bahan (gr/ml/Pcs), sudah dikonversi. */
  qty: number;
  cost: number;
  /** Ada baris yang satuannya tidak bisa dikonversi → qty di bawah perkiraan. */
  hasUnconvertedLines: boolean;
}

/**
 * Total pembelian per bahan dalam rentang tanggal. Dipakai laporan HPP
 * (Persediaan Bahan Baku) dan layar Opname.
 *
 * Sesi AE-194 — qty WAJIB dikonversi ke satuan dasar bahan dulu.
 *
 * Sebelumnya fungsi ini menjumlah `purchase_items.qty` MENTAH, padahal qty itu
 * tersimpan dalam satuan BELI (lihat `unit_override`), sedangkan stok opname
 * dihitung dalam satuan DASAR. Contoh nyata (Juli 2026): Ayam Fillet dibeli
 * "2 Kg" tersimpan sebagai qty=2, lalu dibandingkan dengan stok 2.300 **gram**
 * — pembelian jadi terbaca 2 gram, bukan 2.000 gram. Akibatnya rumus
 * `awal + beli − akhir` menghasilkan pemakaian MINUS di 67 dari 162 bahan.
 * Kolom rupiah tidak pernah kena karena `total_cost` memang uang.
 *
 * Konversi memakai `resolveQtyToMaster` — sumber kebenaran tunggal yang sama
 * dengan Market List, Opname, dan Pembelian, jadi tidak ada aturan satuan baru.
 */
export async function fetchPurchasesByIngredient(
  outletId: string,
  dateFrom: string,
  dateTo: string,
): Promise<Map<string, PurchaseQtyByIngredient>> {
  const lines = await db
    .select({
      ingredientId: purchaseItems.ingredientId,
      qty: purchaseItems.qty,
      qtyDecimal: purchaseItems.qtyDecimal,
      unitSnapshot: purchaseItems.unitSnapshot,
      unitOverride: purchaseItems.unitOverride,
      totalCost: purchaseItems.totalCost,
      masterUnit: ingredients.unit,
      packConversions: ingredients.packConversions,
      unitBelanja: ingredients.unitBelanja,
      unitBelanjaPerCogs: ingredients.unitBelanjaPerCogs,
    })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
    .innerJoin(ingredients, eq(ingredients.id, purchaseItems.ingredientId))
    .where(
      and(
        eq(purchases.outletId, outletId),
        sql`${purchases.status} != 'cancelled'`,
        /* ⚠️ Sesi AE-207 — SENGAJA TIDAK ikut batas buku. Fungsi ini dipakai
         * laporan HPP dan layar Opname, yang rumusnya `awal + beli − akhir`
         * dengan stok awal/akhir dari OPNAME — dan opname tidak bisa di-floor
         * di tanggal yang sama (sesi stok-awal wajib tetap terbaca).
         *
         * Kalau cuma sisi PEMBELIAN yang di-floor, jendela periode lama dapat
         * stok awal & akhir yang benar tapi pembelian 0 → pemakaian MELAMBUNG.
         * Angka salah lebih berbahaya daripada laporan kosong (failure mode
         * AE-202/AE-194). Jadi laporan tetap dihitung dari data asli yang
         * masih utuh, dan periode di luar batas buku DIBERI PERINGATAN di
         * pemanggilnya (lihat banner di cogs/queries.ts getCogsReport). */
        gte(purchases.purchaseDate, dateFrom),
        lte(purchases.purchaseDate, dateTo),
      ),
    );

  const map = new Map<string, PurchaseQtyByIngredient>();
  for (const line of lines) {
    const entry = map.get(line.ingredientId) ?? {
      qty: 0,
      cost: 0,
      hasUnconvertedLines: false,
    };
    entry.cost += Number(line.totalCost);

    /* Decimal mirror adalah qty sebenarnya (0,5 Kg dst); bigint cuma snapshot. */
    const rawQty =
      line.qtyDecimal !== null ? Number(line.qtyDecimal) : Number(line.qty);
    const resolved = resolveQtyToMaster({
      qty: rawQty,
      fromUnit: line.unitOverride ?? line.unitSnapshot,
      masterUnit: line.masterUnit,
      ingredientPacks:
        (line.packConversions as IngredientPackConversion[] | null) ?? null,
      unitBelanja: line.unitBelanja,
      unitBelanjaPerCogs: line.unitBelanjaPerCogs,
    });

    if (resolved.ok && resolved.qtyMaster !== null) {
      entry.qty += resolved.qtyMaster;
    } else {
      /* Tidak bisa dikonversi (satuan beli tanpa data pack). Pakai qty mentah
       * supaya angkanya tidak hilang sama sekali, TAPI tandai barisnya supaya
       * laporan bisa memberi status "perlu dicek" — jangan diam-diam salah. */
      entry.qty += rawQty;
      entry.hasUnconvertedLines = true;
    }

    map.set(line.ingredientId, entry);
  }
  return map;
}

/**
 * Sesi AE-184 — riwayat hutang dagang: SEMUA pembelian TOP, lunas maupun
 * belum. Hanya `payment_method='top'` yang dihitung sebagai hutang; pembelian
 * cash/transfer memang tidak pernah jadi hutang jadi tidak masuk daftar.
 *
 * Cara bayar + nominal pelunasan diambil dari entry kas yang tertaut
 * (`purchases.expense_id`) karena tabel purchases tidak menyimpan cara bayar
 * saat pelunasan — hanya paidAt/paidBy.
 */
export async function fetchTopHistory(
  outletId: string,
  todayIso: string,
  opts: TopHistoryOptions = {},
): Promise<{ items: TopHistoryItem[]; summary: TopHistorySummary }> {
  const conds = [
    eq(purchases.outletId, outletId),
    eq(purchases.paymentMethod, "top"),
  ];
  if (opts.status && opts.status !== "all") {
    conds.push(eq(purchases.status, opts.status));
  }
  /* Sesi AE-207 — riwayat TOP ikut batas buku, TAPI nota yang belum lunas
   * selalu ditampilkan berapa pun tanggalnya. Hutang hidup tidak boleh
   * disembunyikan; yang disembunyikan hanya riwayat yang sudah beres. */
  const cutoff = await getCutoffDate(outletId);
  const topFloor = cutoff
    ? sql`(${purchases.purchaseDate} >= ${cutoff} OR ${purchases.status} = 'pending_payment')`
    : undefined;
  if (topFloor) conds.push(topFloor);
  if (opts.fromDate) conds.push(gte(purchases.purchaseDate, opts.fromDate));
  if (opts.toDate) conds.push(lte(purchases.purchaseDate, opts.toDate));
  if (opts.supplierId) conds.push(eq(purchases.supplierId, opts.supplierId));

  const rows = await db
    .select({
      id: purchases.id,
      purchaseDate: purchases.purchaseDate,
      supplierId: purchases.supplierId,
      supplierName: suppliers.name,
      invoiceNo: purchases.invoiceNo,
      totalAmount: purchases.totalAmount,
      dueDate: purchases.dueDate,
      status: purchases.status,
      paidAt: purchases.paidAt,
      paidByName: users.name,
      cancelledAt: purchases.cancelledAt,
      cancelReason: purchases.cancelReason,
      settlementMethod: expenses.paymentMethod,
      settlementAmount: expenses.amount,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(users, eq(users.id, purchases.paidBy))
    .leftJoin(expenses, eq(expenses.id, purchases.expenseId))
    .where(and(...conds))
    .orderBy(desc(purchases.purchaseDate), desc(purchases.createdAt))
    .limit(Math.min(opts.limit ?? 500, LIMIT_CAP));

  const today = Date.parse(`${todayIso}T00:00:00Z`);
  const items: TopHistoryItem[] = rows.map((r) => {
    /* Hitung jatuh tempo hanya untuk yang masih berjalan — untuk yang sudah
     * lunas angka "telat sekian hari" tidak bermakna lagi. */
    let daysToDue: number | null = null;
    if (r.dueDate && r.status === "pending_payment") {
      daysToDue = Math.round(
        (Date.parse(`${r.dueDate}T00:00:00Z`) - today) / 86_400_000,
      );
    }
    return {
      id: r.id,
      purchaseDate: r.purchaseDate,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      invoiceNo: r.invoiceNo,
      totalAmount: Number(r.totalAmount),
      dueDate: r.dueDate,
      daysToDue,
      status: r.status as TopHistoryStatus,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      paidByName: r.paidByName ?? null,
      settlementMethod: r.settlementMethod ?? null,
      settlementAmount:
        r.settlementAmount === null ? null : Number(r.settlementAmount),
      cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
      cancelReason: r.cancelReason ?? null,
    };
  });

  /* Ringkasan dihitung dari SELURUH hutang TOP (menghormati filter tanggal &
   * supplier, tapi mengabaikan filter status) supaya angka "Belum Bayar" dan
   * "Lunas" tetap utuh saat owner sedang membuka salah satu tab. */
  const baseConds = [
    eq(purchases.outletId, outletId),
    eq(purchases.paymentMethod, "top"),
  ];
  // Ringkasan wajib memakai batas yang sama dengan daftarnya, kalau tidak
  // angka kartu "Lunas" ikut menghitung nota yang sudah disembunyikan.
  if (topFloor) baseConds.push(topFloor);
  if (opts.fromDate) baseConds.push(gte(purchases.purchaseDate, opts.fromDate));
  if (opts.toDate) baseConds.push(lte(purchases.purchaseDate, opts.toDate));
  if (opts.supplierId) baseConds.push(eq(purchases.supplierId, opts.supplierId));

  const agg = await db
    .select({
      status: purchases.status,
      n: sql<string>`COUNT(*)`,
      total: sql<string>`COALESCE(SUM(${purchases.totalAmount}), 0)`,
    })
    .from(purchases)
    .where(and(...baseConds))
    .groupBy(purchases.status);

  const summary: TopHistorySummary = {
    outstandingCount: 0,
    outstandingAmount: 0,
    dueSoonAmount: 0,
    overdueAmount: 0,
    paidCount: 0,
    paidAmount: 0,
    cancelledCount: 0,
    cancelledAmount: 0,
  };
  for (const a of agg) {
    const n = Number(a.n);
    const total = Number(a.total);
    if (a.status === "pending_payment") {
      summary.outstandingCount = n;
      summary.outstandingAmount = total;
    } else if (a.status === "paid") {
      summary.paidCount = n;
      summary.paidAmount = total;
    } else if (a.status === "cancelled") {
      summary.cancelledCount = n;
      summary.cancelledAmount = total;
    }
  }

  /* Jatuh tempo dari SELURUH hutang berjalan (tidak ikut filter status),
   * supaya kartu ringkasan tetap benar di tab mana pun. */
  const dueRows = await db
    .select({
      dueDate: purchases.dueDate,
      totalAmount: purchases.totalAmount,
    })
    .from(purchases)
    .where(
      and(...baseConds, eq(purchases.status, "pending_payment")),
    );
  for (const d of dueRows) {
    if (!d.dueDate) continue;
    const days = Math.round(
      (Date.parse(`${d.dueDate}T00:00:00Z`) - today) / 86_400_000,
    );
    if (days < 0) summary.overdueAmount += Number(d.totalAmount);
    else if (days <= 3) summary.dueSoonAmount += Number(d.totalAmount);
  }

  return { items, summary };
}
