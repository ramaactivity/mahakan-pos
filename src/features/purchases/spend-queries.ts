import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  goodsReceiptItems,
  goodsReceipts,
  ingredients,
  purchaseItems,
  purchases,
  suppliers,
} from "@/db/schema";
import { clampFromDate, getCutoffDate } from "@/features/cutoff/cutoff";
import {
  normalizeSpendPaymentMethod,
  normalizeSpendSection,
  previousRangeOf,
  type SpendDateBasis,
  type SpendLine,
} from "./spend-recap-pure";

/**
 * Sesi AE-222 — sumber baris untuk Rekap Pembelanjaan.
 *
 * Dua sumber digabung, persis seperti modul Masuk Bahan (AE-192), karena
 * riwayat produksi memuat keduanya:
 *   1. `goods_receipt_items` — alur PR → PO → GR (mayoritas sejak Juni 2026).
 *   2. `purchase_items` dari pembelian berstatus diterima yang TIDAK punya
 *      baris GR sama sekali (jalur `createPurchase` lama).
 * Kalau salah satu dilewatkan, rekapnya diam-diam kurang — tanpa error.
 *
 * `not exists (… goods_receipts …)` di sumber 2 adalah rem anti dobel-hitung:
 * satu pembelian tidak boleh ikut lewat dua jalur sekaligus.
 */

/** Cap baris. Volume nyata ~5–15 baris/nota, ~30 nota/bulan → setahun ± 4rb. */
const LINE_CAP = 20000;

export interface FetchSpendLinesOptions {
  dateFrom: string;
  dateTo: string;
  /** 'receipt' = tanggal barang masuk (default), 'purchase' = tanggal nota. */
  dateBasis: SpendDateBasis;
}

/**
 * Kolom `date` Postgres dibaca drizzle sebagai string "YYYY-MM-DD". Kalau
 * suatu saat driver mengembalikan objek Date, `String(d)` akan menghasilkan
 * "Fri Aug 29 2026 …" dan SELURUH pengelompokan bulan/tanggal rusak diam-diam
 * (kunci grup jadi "Fri Aug"). Murah untuk dijaga di sini sekali.
 */
function toIsoDate(v: unknown): string {
  if (v instanceof Date) {
    /* WAJIB pakai bagian tanggal LOKAL, bukan `toISOString()`. Driver mem-
     * parse kolom `date` sebagai tengah malam waktu lokal; di WIB (UTC+7)
     * tengah malam 1 Juli = 30 Juni 17:00 UTC, jadi `toISOString()` akan
     * memundurkan SEMUA tanggal satu hari tanpa error apa pun. */
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v ?? "").slice(0, 10);
}

function toNumber(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Baris belanja dalam satu rentang tanggal. Tidak memfilter section/bahan/
 * supplier — penyaringan itu dilakukan di lapisan murni supaya satu kali
 * ambil bisa sekaligus memberi total, semua rincian, DAN isi dropdown.
 */
export async function fetchSpendLines(
  outletId: string,
  opts: FetchSpendLinesOptions,
): Promise<{ lines: SpendLine[]; truncated: boolean }> {
  const { dateFrom, dateTo, dateBasis } = opts;
  if (!dateFrom || !dateTo || dateTo < dateFrom) {
    return { lines: [], truncated: false };
  }

  const notCancelled = sql`${purchases.status} <> 'cancelled' and ${purchases.receiptStatus} <> 'cancelled'`;

  /* Tanggal yang dipakai menaruh belanja di kalender. Di jalur GR owner bisa
   * memilih tanggal terima (yang menyentuh jurnal) atau tanggal nota. */
  const grDateCol =
    dateBasis === "purchase" ? purchases.purchaseDate : goodsReceipts.receivedDate;

  const grRows = await db
    .select({
      id: goodsReceiptItems.id,
      date: grDateCol,
      purchaseId: purchases.id,
      purchaseDate: purchases.purchaseDate,
      invoiceNo: purchases.invoiceNo,
      supplierId: purchases.supplierId,
      supplierName: suppliers.name,
      ingredientId: goodsReceiptItems.ingredientId,
      ingredientName: goodsReceiptItems.ingredientNameSnapshot,
      /* JEBAKAN AE-177f: baris GR hanya menyimpan satuan MASTER, padahal
       * `received_qty` disimpan dalam SATUAN YANG DIPILIH saat memesan (mis.
       * 2 "Pack", 6 "Kg"). Tanpa join ke purchase_items, rekap akan menulis
       * "Beans Houseblend 6 gr" untuk belanja Rp 990.000 — angkanya benar,
       * satuannya bohong. */
      unit: sql<string>`coalesce(${purchaseItems.unitOverride}, ${goodsReceiptItems.unitSnapshot})`,
      /* Snapshot section bisa NULL untuk baris lama; master jadi cadangan
       * supaya belanja tidak menumpuk di "Belum diset". */
      section: sql<string | null>`coalesce(${goodsReceiptItems.sectionSnapshot}, ${ingredients.section})`,
      qty: goodsReceiptItems.receivedQty,
      qtyDecimal: goodsReceiptItems.receivedQtyDecimal,
      totalCost: goodsReceiptItems.totalCost,
      paymentMethod: purchases.paymentMethod,
      paymentStatus: purchases.status,
    })
    .from(goodsReceiptItems)
    .innerJoin(
      goodsReceipts,
      eq(goodsReceipts.id, goodsReceiptItems.goodsReceiptId),
    )
    .innerJoin(purchases, eq(purchases.id, goodsReceipts.purchaseId))
    .leftJoin(
      purchaseItems,
      eq(purchaseItems.id, goodsReceiptItems.purchaseItemId),
    )
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(ingredients, eq(ingredients.id, goodsReceiptItems.ingredientId))
    .where(
      and(
        eq(goodsReceipts.outletId, outletId),
        gte(grDateCol, dateFrom),
        lte(grDateCol, dateTo),
        notCancelled,
      ),
    )
    .limit(LINE_CAP + 1);

  const directRows = await db
    .select({
      id: purchaseItems.id,
      date: purchases.purchaseDate,
      purchaseId: purchases.id,
      purchaseDate: purchases.purchaseDate,
      invoiceNo: purchases.invoiceNo,
      supplierId: purchases.supplierId,
      supplierName: suppliers.name,
      ingredientId: purchaseItems.ingredientId,
      ingredientName: purchaseItems.ingredientNameSnapshot,
      unit: sql<string>`coalesce(${purchaseItems.unitOverride}, ${purchaseItems.unitSnapshot})`,
      section: sql<string | null>`coalesce(${purchaseItems.sectionSnapshot}, ${ingredients.section})`,
      qty: purchaseItems.qty,
      qtyDecimal: purchaseItems.qtyDecimal,
      totalCost: purchaseItems.totalCost,
      paymentMethod: purchases.paymentMethod,
      paymentStatus: purchases.status,
    })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(ingredients, eq(ingredients.id, purchaseItems.ingredientId))
    .where(
      and(
        eq(purchases.outletId, outletId),
        gte(purchases.purchaseDate, dateFrom),
        lte(purchases.purchaseDate, dateTo),
        notCancelled,
        sql`${purchases.receiptStatus} in ('received', 'partial')`,
        /* Kolom outer WAJIB literal ber-prefix tabel (jebakan AE-192): di
         * dalam sql`` drizzle merender `${purchases.id}` jadi "id" polos yang
         * ke-tangkap kolom tabel dalam — diam, tanpa error. */
        sql`not exists (select 1 from goods_receipts gr where gr.purchase_id = purchases.id)`,
      ),
    )
    .limit(LINE_CAP + 1);

  type RawRow = (typeof grRows)[number] | (typeof directRows)[number];
  const mapRow = (r: RawRow, source: "gr" | "direct"): SpendLine => ({
    id: r.id,
    source,
    date: toIsoDate(r.date),
    purchaseId: r.purchaseId,
    purchaseDate: toIsoDate(r.purchaseDate),
    invoiceNo: r.invoiceNo,
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    ingredientId: r.ingredientId,
    ingredientName: r.ingredientName,
    unit: r.unit,
    section: normalizeSpendSection(r.section),
    // Mirror desimal adalah kebenaran qty (0,5 Kg dst); bigint cuma snapshot.
    qty: r.qtyDecimal !== null ? toNumber(r.qtyDecimal) : toNumber(r.qty),
    amount: toNumber(r.totalCost),
    paymentMethod: normalizeSpendPaymentMethod(r.paymentMethod),
    // 'cancelled' sudah tersaring di WHERE; sisanya hanya dua nilai ini.
    paymentStatus: r.paymentStatus === "paid" ? "paid" : "pending_payment",
  });

  const truncated = grRows.length > LINE_CAP || directRows.length > LINE_CAP;
  return {
    lines: [
      ...grRows.slice(0, LINE_CAP).map((r) => mapRow(r, "gr")),
      ...directRows.slice(0, LINE_CAP).map((r) => mapRow(r, "direct")),
    ],
    truncated,
  };
}

/**
 * PO yang sudah dipesan tapi barangnya belum (atau baru sebagian) diterima.
 * SENGAJA di luar total rekap — belum ada barang, belum ada jurnal, jadi
 * memasukkannya akan membuat rekap tidak pernah cocok dengan Laba Rugi.
 * Ditampilkan terpisah supaya pesanan menggantung tetap kelihatan.
 *
 * Tidak dibatasi rentang tanggal: PO menggantung dari bulan lalu justru yang
 * paling perlu terlihat.
 */
export async function fetchPendingOrderTotals(
  outletId: string,
): Promise<{ count: number; amount: number }> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      /* Sisa nilai = nilai PO dikurangi yang sudah diterima lewat GR. */
      amount: sql<number>`coalesce(sum(greatest(
        purchases.total_amount - coalesce((
          select sum(gr.total_amount) from goods_receipts gr
          where gr.purchase_id = purchases.id
        ), 0), 0)), 0)::bigint`,
    })
    .from(purchases)
    .where(
      and(
        eq(purchases.outletId, outletId),
        sql`${purchases.receiptStatus} in ('ordered', 'partial')`,
        sql`${purchases.status} <> 'cancelled'`,
      ),
    );
  return { count: toNumber(row?.count), amount: toNumber(row?.amount) };
}

/**
 * Rentang efektif setelah batas buku (AE-207). Rekap adalah jalur BACA
 * laporan, jadi wajib ikut di-floor — kalau tidak, layar "mulai bersih"
 * bocor lewat pintu belakang.
 */
export async function resolveSpendRange(
  outletId: string,
  dateFrom: string,
  dateTo: string,
): Promise<{
  from: string;
  to: string;
  cutoffApplied: string | null;
  /** NULL kalau periode pembanding seluruhnya ada di balik batas buku. */
  previous: { from: string; to: string } | null;
}> {
  const cutoff = await getCutoffDate(outletId);
  const from = (clampFromDate(dateFrom, cutoff) as string) ?? dateFrom;
  const cutoffApplied = cutoff && from !== dateFrom ? cutoff : null;

  const raw = previousRangeOf(from, dateTo);
  /* Pembanding ikut di-floor. Kalau SELURUHNYA di balik batas buku, hasilnya
   * dikosongkan (null) — bukan dipepetkan ke tanggal batas, karena rentang
   * sisa satu hari akan tampil sebagai "belanja turun 97%" yang menyesatkan. */
  let previous: { from: string; to: string } | null = raw;
  if (cutoff) {
    if (raw.to < cutoff) previous = null;
    else previous = { from: raw.from < cutoff ? cutoff : raw.from, to: raw.to };
  }
  return { from, to: dateTo, cutoffApplied, previous };
}
