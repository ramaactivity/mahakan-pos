/**
 * Sesi AE-113 — Server queries untuk COGS + Variance report per bulan.
 *
 * Data sources:
 *   - Stock Awal: opname session last finalized BEFORE period start.
 *     stock_opname_lines.actual_qty_decimal + unit_cost_at_snapshot.
 *   - Pembelian: purchase_items WHERE purchases.purchase_date in period
 *     AND purchases.status != 'cancelled'.
 *   - Stock Akhir: opname session last finalized WITHIN or just after
 *     period end (per akhir bulan WIB).
 *   - Theoretical usage: SUM(recipe_ingredients.qty × transaction_items.qty)
 *     WHERE transactions in period AND status='paid'.
 */

import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  goodsReceiptItems,
  goodsReceipts,
  ingredients,
  inventoryMovements,
  outlets,
  purchaseItems,
  purchases,
} from "@/db/schema";
import { getStockMode } from "@/features/inventory/flag";
import { getCutoffDate } from "@/features/cutoff/cutoff";
import {
  fetchLatestOpnameBefore,
  fetchLatestOpnameWithin,
} from "@/features/reports/inventory-reports";
import {
  computeIngredientCogs,
  parseMonthlyPeriod,
  summarizeCogs,
  type IngredientCogsInput,
  type IngredientCogsRow,
  type CogsSummary,
} from "./cogs-calc";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Tanggal kalender Jakarta (YYYY-MM-DD) dari sebuah timestamp. */
function jakartaIsoDate(d: Date): string {
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** Selisih hari antara dua tanggal YYYY-MM-DD (b − a). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export interface OpnameRef {
  id: string;
  periodLabel: string;
  /** ISO timestamp saat opname disetujui. */
  finalizedAt: string;
  /** YYYY-MM-DD (WIB) saat stok fisik dihitung. */
  countedAt: string;
}

export interface CogsReport {
  period: ReturnType<typeof parseMonthlyPeriod>;
  outletName: string;
  rows: IngredientCogsRow[];
  summary: CogsSummary;
  /** Banners untuk UI display kalau data tidak lengkap. */
  banners: string[];
  /**
   * Sesi AE-202 — FALSE kalau pemakaian/COGS periode ini belum bisa dihitung
   * (mode periodic + belum ada opname di periode). UI WAJIB menampilkan "—"
   * untuk Stok Akhir, Pemakaian, dan Total COGS; Tutup Periode harus dikunci.
   */
  usageComputable: boolean;
  /** Opname yang dipakai jadi stok awal/akhir — supaya UI bisa show context.
   *  `countedAt` = tanggal HITUNG FISIK (WIB), inilah yang menentukan periode;
   *  `finalizedAt` cuma tanggal persetujuan. */
  lastOpname: {
    before: OpnameRef | null;
    within: OpnameRef | null;
  };
  /** Per-period purchase stats untuk surface ke UI. */
  purchaseStats: {
    activeCount: number;
    cancelledCount: number;
  };
}

/**
 * Main entry: fetch COGS + Variance report untuk outlet + bulan.
 */
export async function getCogsReport(args: {
  outletId: string;
  /** YYYY-MM */
  ym: string;
}): Promise<CogsReport> {
  const period = parseMonthlyPeriod(args.ym);
  const banners: string[] = [];

  /* Sesi AE-207 — laporan HPP untuk periode SEBELUM batas buku sengaja TIDAK
   * di-klem sebagian, tapi diberi peringatan jujur.
   *
   * Kenapa bukan di-floor saja: pembelian periode lama akan jadi 0 sementara
   * stok awal & stok akhir tetap terbaca dari opname → rumus
   * `awal + beli − akhir` menghasilkan PEMAKAIAN MELAMBUNG. Angka salah lebih
   * berbahaya daripada laporan kosong (ini failure mode AE-202/AE-194).
   * Jadi laporan tetap dihitung dari data asli yang masih utuh di database,
   * dan owner diberi tahu bahwa periode ini di luar buku yang berlaku. */
  const cutoff = await getCutoffDate(args.outletId);
  if (cutoff && period.fromDate < cutoff) {
    banners.push(
      `Periode ${period.label} ada SEBELUM batas buku (${cutoff}). Angka di bawah dihitung dari data lama yang sudah disembunyikan dari halaman lain, jadi tidak nyambung dengan Neraca & Laba Rugi yang berlaku sekarang. Pakai hanya untuk penelusuran riwayat.`,
    );
  }

  const stockMode = await getStockMode(args.outletId);
  /** Sesi AE-246 — `current_stock` hanya boleh dipakai sebagai stok akhir
   * kalau KEDUA sisinya hidup: pembelian menambah DAN penjualan mengurangi.
   * Menyalakan pembelian saja membuat angkanya cuma pernah NAIK — itu lebih
   * menyesatkan daripada beku, karena terlihat hidup. Saat dua-duanya mati
   * (keadaan sekarang) hasilnya sama persis dengan rumus lama. */
  const periodicMode = !(stockMode.deductOnSale && stockMode.addOnPurchase);

  // ──────────────────────────────────────────────────────────────
  // 1. Outlet info
  // ──────────────────────────────────────────────────────────────
  const [outlet] = await db
    .select({ name: outlets.name })
    .from(outlets)
    .where(eq(outlets.id, args.outletId))
    .limit(1);

  // ──────────────────────────────────────────────────────────────
  // 2. All active atomic ingredients (excl. preparations supaya tidak
  //    double-count; preparation cost cascading dari atomic bahan).
  //    User dapat opt-in untuk include preparations di future.
  // ──────────────────────────────────────────────────────────────
  const ings = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      section: ingredients.section,
      costPerUnit: ingredients.costPerUnit,
      isPreparation: ingredients.isPreparation,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, args.outletId),
        isNull(ingredients.deletedAt),
        eq(ingredients.isPreparation, false),
      ),
    );

  // ──────────────────────────────────────────────────────────────
  // 3. Opname terakhir yang DIHITUNG sebelum awal periode → stock awal
  //
  //    Sesi AE-201 — pakai `fetchLatestOpnameBefore` (kriteria `started_at`,
  //    yaitu TANGGAL HITUNG FISIK), bukan `finalized_at` (tanggal disetujui).
  //    Persetujuan sering menyusul berhari-hari sampai lewat batas bulan:
  //    opname "Juli" dihitung 31 Juli baru disetujui 1 Agustus 09:02, opname
  //    "Juni" dihitung 30 Juni baru disetujui 14 Juli. Dengan `finalized_at`
  //    SETIAP bulan meleset satu siklus — stok akhir bulan lalu tidak pernah
  //    jadi stok awal bulan ini (laporan Juli memakai hitungan Mei sebagai
  //    stok awal), lalu awal + beli − akhir menghasilkan pemakaian minus.
  //    Helper-nya dipakai bareng laporan HPP supaya tidak ada logika kembar.
  // ──────────────────────────────────────────────────────────────
  const opnameBefore = await fetchLatestOpnameBefore(
    args.outletId,
    period.fromDate,
  );

  const stockAwalByIng = new Map<
    string,
    { qty: number; unitCost: number | undefined }
  >();
  /* AE-117 — Fallback map kalau no prev opname: net delta movements
   * dalam period per ingredient. Stock awal = current_stock - net_delta.
   * Math-guaranteed: stock_awal + delta = stock_akhir. */
  let periodMovementByIng: Map<string, number> | null = null;

  if (opnameBefore) {
    for (const [ingredientId, qty] of opnameBefore.qtyByIngredient) {
      stockAwalByIng.set(ingredientId, {
        qty,
        unitCost: opnameBefore.costByIngredient.get(ingredientId),
      });
    }
  } else if (periodicMode) {
    /* Sesi AE-202 — mode periodic tanpa opname pembuka: stok awal TIDAK
     * diketahui. Rumus lama `current_stock − pergerakan` mengandaikan stok
     * ikut bergerak tiap transaksi; di mode periodic dia beku, dan
     * pergerakannya ber-skippedStockUpdate, sehingga hasilnya angka MINUS
     * (mis. Beans Houseblend −4.611 di Mei 2026). Lebih jujur: 0 + banner,
     * dan seluruh pemakaian periode ini ditandai belum bisa dihitung. */
    banners.push(
      `Belum ada opname sebelum ${period.fromDate}, dan mode persediaan periodic. Stok awal belum diketahui sehingga pemakaian periode ini belum bisa dihitung.`,
    );
  } else {
    banners.push(
      `Belum ada opname sebelum ${period.fromDate}. Stock Awal di-derive dari current stock minus movements bulan ini (math-guaranteed: awal + delta = akhir).`,
    );

    const periodMovements = await db.execute<{
      ingredient_id: string;
      net_delta: string;
    }>(sql`
      SELECT
        im.ingredient_id,
        COALESCE(SUM(im.qty_delta_decimal), 0)::text AS net_delta
      FROM inventory_movements im
      WHERE im.outlet_id = ${args.outletId}
        AND im.created_at >= ${period.fromDate + ' 00:00:00+07:00'}
        AND im.created_at <= ${period.toDate + ' 23:59:59+07:00'}
      GROUP BY im.ingredient_id
    `);
    const movArr = ((periodMovements as unknown as { rows?: unknown[] }).rows ?? []) as Array<{
      ingredient_id: string; net_delta: string;
    }>;
    periodMovementByIng = new Map(movArr.map((r) => [r.ingredient_id, Number(r.net_delta)]));
  }

  // ──────────────────────────────────────────────────────────────
  // 4. Pembelian within period — separate active vs cancelled counts.
  //    For COGS computation, use ONLY active purchases.
  //    Surface cancelled count to UI for transparency.
  //
  //    Query: join via inventory_movements (master unit qty, source of
  //    truth post-AE-43). purchase_items.qty_decimal is RAW input, may
  //    not be in master unit kalau ada conversion.
  // ──────────────────────────────────────────────────────────────
  const purchaseStatsRows = await db.execute<{ status: string; count: string }>(sql`
    SELECT p.status, COUNT(*)::text AS count
    FROM purchases p
    WHERE p.outlet_id = ${args.outletId}
      AND p.purchase_date >= ${period.fromDate}
      AND p.purchase_date <= ${period.toDate}
      AND p.receipt_status = 'received'
    GROUP BY p.status
  `);
  const psArr = ((purchaseStatsRows as unknown as { rows?: unknown[] }).rows ?? []) as Array<{ status: string; count: string }>;
  let activePurchaseCount = 0;
  let cancelledPurchaseCount = 0;
  for (const r of psArr) {
    const n = parseInt(r.count, 10);
    if (r.status === "cancelled") cancelledPurchaseCount += n;
    else activePurchaseCount += n;
  }
  if (cancelledPurchaseCount > 0 && activePurchaseCount === 0) {
    banners.push(
      `Tidak ada pembelian aktif di periode ${period.label} (${cancelledPurchaseCount} dibatalkan). Tambah pembelian via Inventory → Pembelian → Catat Pembelian.`,
    );
  }

  /* Sesi AE-173 — Pembelian = barang DITERIMA (GR) di periode. Dua sumber,
   * tanpa double-count:
   *  (a) GR receipts (goods_receipt_items) by goods_receipts.received_date —
   *      mendukung partial (PO 'partial') + atribusi ke tanggal TERIMA.
   *  (b) Instant purchase (createPurchase, receiptStatus='received', TANPA GR
   *      record) by purchase_date. */
  const pembelianByIng = new Map<string, { qty: number; total: number }>();

  // (a) GR receipts dalam periode (by received_date).
  /* Sesi AE-177g — JOIN purchases + EXCLUDE status='cancelled'. cancelPurchase
   * utk PO yang sudah received/partial cuma set `purchases.status='cancelled'`,
   * tidak menyentuh `receiptStatus`. Tanpa filter ini, GR dari pembelian yang
   * dibatalkan ikut nyumbang ke kolom Pembelian → COGS overstated 2x
   * (counter-movement sudah benerin stockAkhir, tapi pembelian tetap +75 → bias). */
  const grRows = await db
    .select({
      ingredientId: goodsReceiptItems.ingredientId,
      movementQty: inventoryMovements.qtyDeltaDecimal,
      receivedRaw: goodsReceiptItems.receivedQtyDecimal,
      totalCost: goodsReceiptItems.totalCost,
    })
    .from(goodsReceiptItems)
    .innerJoin(
      goodsReceipts,
      eq(goodsReceipts.id, goodsReceiptItems.goodsReceiptId),
    )
    .innerJoin(purchases, eq(purchases.id, goodsReceipts.purchaseId))
    .leftJoin(
      inventoryMovements,
      eq(goodsReceiptItems.movementId, inventoryMovements.id),
    )
    .where(
      and(
        eq(goodsReceipts.outletId, args.outletId),
        gte(goodsReceipts.receivedDate, period.fromDate),
        lte(goodsReceipts.receivedDate, period.toDate),
        sql`${purchases.status} != 'cancelled'`,
      ),
    );
  for (const r of grRows) {
    const qty =
      r.movementQty != null
        ? Number(r.movementQty)
        : r.receivedRaw != null
          ? Number(r.receivedRaw)
          : 0;
    const cur = pembelianByIng.get(r.ingredientId) ?? { qty: 0, total: 0 };
    cur.qty += qty;
    cur.total += r.totalCost;
    pembelianByIng.set(r.ingredientId, cur);
  }

  // (b) Instant purchase (received, TANPA GR record) by purchase_date.
  const instantRows = await db
    .select({
      ingredientId: purchaseItems.ingredientId,
      movementQtyDeltaDecimal: inventoryMovements.qtyDeltaDecimal,
      qtyDecimalRaw: purchaseItems.qtyDecimal,
      qtyBigint: purchaseItems.qty,
      totalCost: purchaseItems.totalCost,
    })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
    .leftJoin(
      inventoryMovements,
      eq(purchaseItems.movementId, inventoryMovements.id),
    )
    .where(
      and(
        eq(purchases.outletId, args.outletId),
        gte(purchases.purchaseDate, period.fromDate),
        lte(purchases.purchaseDate, period.toDate),
        sql`${purchases.status} != 'cancelled'`,
        eq(purchases.receiptStatus, "received"),
        sql`NOT EXISTS (SELECT 1 FROM goods_receipts gr WHERE gr.purchase_id = ${purchases.id})`,
      ),
    );
  for (const r of instantRows) {
    let qty: number;
    if (r.movementQtyDeltaDecimal != null) qty = Number(r.movementQtyDeltaDecimal);
    else if (r.qtyDecimalRaw != null) qty = Number(r.qtyDecimalRaw);
    else qty = r.qtyBigint;
    const cur = pembelianByIng.get(r.ingredientId) ?? { qty: 0, total: 0 };
    cur.qty += qty;
    cur.total += r.totalCost;
    pembelianByIng.set(r.ingredientId, cur);
  }

  // ──────────────────────────────────────────────────────────────
  // 5. Opname terakhir yang DIHITUNG di dalam periode → stock akhir.
  //
  //    Sesi AE-201 — dulu: `finalized_at >= awal periode` diurut ASC TANPA
  //    batas atas, jadi yang terambil hitungan paling awal yang DISETUJUI
  //    setelah tanggal 1 — biasanya opname BULAN SEBELUMNYA yang persetujuannya
  //    telat. Sekarang batasnya tanggal hitung fisik di dalam [from, to].
  // ──────────────────────────────────────────────────────────────
  const opnameWithin = await fetchLatestOpnameWithin(
    args.outletId,
    period.fromDate,
    period.toDate,
  );

  /* Sesi AE-202 — pemakaian butuh KEDUA ujungnya diketahui. Di mode periodic
   * itu berarti ada opname sebelum periode (stok awal) DAN di dalam periode
   * (stok akhir); di mode perpetual `current_stock` hidup jadi selalu bisa. */
  const usageComputable =
    !periodicMode || (opnameBefore !== null && opnameWithin !== null);

  const stockAkhirByIng = new Map<string, number>();
  if (opnameWithin) {
    for (const [ingredientId, qty] of opnameWithin.qtyByIngredient) {
      stockAkhirByIng.set(ingredientId, qty);
    }
  } else if (stockMode.deductOnSale || stockMode.addOnPurchase) {
    /* Sesi AE-177g — Banner jujur: kode pakai `currentStockDecimal` sebagai
     * fallback (lihat baris pembentukan IngredientCogsInput), BUKAN 0.
     * COGS hasilnya = pemakaian aktual via invariant `awal + delta = akhir`.
     * Tetap kurang akurat karena tidak ada hitung fisik akhir periode. */
    banners.push(
      `Belum ada opname dalam periode ${period.label}. Stock Akhir pakai stok saat ini (current) — COGS approximate, hitung opname akhir bulan utk akurasi.`,
    );
  } else {
    /* Sesi AE-202 — MODE PERIODIC + belum ada opname = stok akhir TIDAK
     * DIKETAHUI. `current_stock` beku di angka opname terakhir (penjualan tak
     * mengurangi, pembelian ber-skippedStockUpdate), jadi memakainya sebagai
     * stok akhir membuat rumus jadi
     *   (opname lalu) + beli − (opname lalu) = SELURUH PEMBELIAN,
     * seolah semua belanja habis terpakai. Itu yang bikin Agustus 2026 tampil
     * "pemakaian Rp 6 jt" padahal belum ada hitungan fisik sama sekali. */
    banners.push(
      `Belum ada opname di periode ${period.label}, dan mode persediaan periodic (stok hanya bergerak dari opname). Stok akhir & pemakaian BELUM BISA DIHITUNG — kolomnya ditampilkan "—". Lakukan Stock Opname untuk melihat pemakaian.`,
    );
  }

  /* Sesi AE-201 — sebut terang-terangan hitungan mana yang jadi stok awal &
   * stok akhir, memakai TANGGAL HITUNG (bukan tanggal setuju). Owner sempat
   * ragu "stok akhir SO tidak jadi stok awal bulan berikutnya" — sekarang bisa
   * dicek langsung dari layar. */
  if (opnameBefore || opnameWithin) {
    const akhirLabel = opnameWithin
      ? `opname ${opnameWithin.periodLabel} (dihitung ${jakartaIsoDate(opnameWithin.countedAt)})`
      : usageComputable
        ? "stok saat ini (belum ada opname di periode)"
        : "belum dihitung";
    banners.push(
      `Stok awal = ${opnameBefore ? `opname ${opnameBefore.periodLabel} (dihitung ${jakartaIsoDate(opnameBefore.countedAt)})` : "—"}` +
        ` · Stok akhir = ${akhirLabel}.`,
    );
  }

  /* Jeda hari antara hitungan stok awal dengan awal periode: belanja di
   * rentang itu tidak masuk hitungan fisik mana pun, jadi pemakaian bisa
   * tampak minus. Bukan bug rumus — hitung opname di akhir bulan. */
  if (opnameBefore) {
    const gapDays = daysBetween(
      jakartaIsoDate(opnameBefore.countedAt),
      period.fromDate,
    );
    if (gapDays > 1) {
      banners.push(
        `Opname stok awal dihitung ${jakartaIsoDate(opnameBefore.countedAt)}, ${gapDays - 1} hari sebelum ${period.fromDate}. Belanja di sela hari itu tidak terhitung di periode mana pun — pemakaian bisa tampak minus. Hitung opname di hari terakhir bulan supaya pas.`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 6. Theoretical usage: SUM(recipe_ingredients.qty × transaction_items.qty)
  //    WHERE transactions in period AND status='paid'.
  //    Group by ingredient_id.
  //
  //    JOIN chain:
  //      transactions → transaction_items → recipes (via menu_item_id + variant)
  //        → recipe_ingredients → ingredients
  //
  //    Variant handling: recipe per menu_item × variant. Match by exact variant.
  // ──────────────────────────────────────────────────────────────
  const theoreticalRows = await db.execute<{
    ingredient_id: string;
    total_qty: string;
  }>(sql`
    SELECT
      ri.ingredient_id,
      SUM(ri.qty * ti.quantity) AS total_qty
    FROM transactions tr
    INNER JOIN transaction_items ti ON ti.transaction_id = tr.id
    INNER JOIN recipes rc ON rc.menu_item_id = ti.menu_item_id
      AND (
        (rc.variant IS NULL AND ti.variant IS NULL)
        OR (rc.variant = ti.variant)
      )
    INNER JOIN recipe_ingredients ri ON ri.recipe_id = rc.id
    WHERE tr.outlet_id = ${args.outletId}
      AND tr.status = 'paid'
      AND tr.created_at >= ${period.fromDate + " 00:00:00+07:00"}
      AND tr.created_at <= ${period.toDate + " 23:59:59+07:00"}
    GROUP BY ri.ingredient_id
  `);
  const theoreticalArr = ((theoreticalRows as unknown as { rows?: unknown[] }).rows ?? []) as Array<{
    ingredient_id: string;
    total_qty: string;
  }>;
  const theoreticalByIng = new Map<string, number>();
  for (const r of theoreticalArr) {
    theoreticalByIng.set(r.ingredient_id, Number(r.total_qty));
  }

  // ──────────────────────────────────────────────────────────────
  // 7. Need current_stock_decimal per ingredient untuk fallback stock awal
  //    calc (kalau periodMovementByIng available). Already fetched in
  //    `ings` query → use ing.currentStockDecimal.
  // ──────────────────────────────────────────────────────────────
  /* Refetch current stock decimal (was not selected in original ings query). */
  const currentStockRows = await db
    .select({
      id: ingredients.id,
      currentStockDecimal: ingredients.currentStockDecimal,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, args.outletId),
        isNull(ingredients.deletedAt),
      ),
    );
  const currentStockByIng = new Map(
    currentStockRows.map((r) => [r.id, Number(r.currentStockDecimal ?? 0)]),
  );

  // ──────────────────────────────────────────────────────────────
  // 8. Compute per-ingredient rows
  // ──────────────────────────────────────────────────────────────
  const rows: IngredientCogsRow[] = [];
  /** Bahan yang punya stok tercatat tapi tidak ikut opname periode ini. */
  const uncountedNames: string[] = [];
  for (const ing of ings) {
    const sa = stockAwalByIng.get(ing.id);
    const pb = pembelianByIng.get(ing.id);
    const sk = stockAkhirByIng.get(ing.id);
    const th = theoreticalByIng.get(ing.id);

    /* AE-117 — Derive stock awal qty when no prev opname:
     * stock_awal = current_stock - SUM(movements_in_period)
     * Math-guaranteed: stock_awal + delta = stock_akhir. */
    let stockAwalQty = sa?.qty ?? 0;
    let stockAwalAvgPrice = sa?.unitCost ?? ing.costPerUnit;
    if (!sa && periodMovementByIng) {
      const current = currentStockByIng.get(ing.id) ?? 0;
      const netDelta = periodMovementByIng.get(ing.id) ?? 0;
      stockAwalQty = current - netDelta;
      // Harga awal pakai costPerUnit master (Rama's request AE-117).
      stockAwalAvgPrice = ing.costPerUnit;
    }

    /* Sesi AE-201 — bahan yang TIDAK ikut dihitung di opname periode ini
     * (biasanya bahan yang baru dibuat setelah opname) dulu jatuh ke
     * `current_stock` — yaitu stok HARI INI, dipakai sebagai stok akhir bulan
     * yang sudah lewat, padahal stok awalnya 0. Hasilnya pemakaian minus palsu
     * (mis. Sabun Cuci Piring −75.000 di Juni) dan rantai antar bulan putus.
     * Kalau opname periode ini ADA, bahan yang tak tercatat di dalamnya
     * dianggap 0 dan dilaporkan lewat banner. `current_stock` hanya dipakai
     * saat memang belum ada opname sama sekali di periode (bulan berjalan). */
    let stockAkhirQty: number;
    if (sk !== undefined) {
      stockAkhirQty = sk;
    } else if (opnameWithin) {
      stockAkhirQty = 0;
      const cur = currentStockByIng.get(ing.id) ?? 0;
      if (cur !== 0) uncountedNames.push(ing.name);
    } else {
      /* Belum ada opname di periode. Di mode perpetual `current_stock` hidup
       * jadi masih masuk akal; di mode periodic dia beku → tandai UNKNOWN. */
      stockAkhirQty = periodicMode ? 0 : currentStockByIng.get(ing.id) ?? 0;
    }

    /* Skip bahan kalau benar-benar no data (clean output). */
    if (!sa && !pb && !sk && !th && stockAwalQty === 0) continue;

    const input: IngredientCogsInput = {
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit,
      section: ing.section,
      stockAwalQty,
      stockAwalAvgPrice,
      pembelianQty: pb?.qty ?? 0,
      pembelianTotal: pb?.total ?? 0,
      stockAkhirQty,
      stockAkhirUnknown: !usageComputable,
      theoreticalUsageQty: th ?? 0,
      currentCostPerUnit: ing.costPerUnit,
    };

    rows.push(computeIngredientCogs(input));
  }

  if (uncountedNames.length > 0 && opnameWithin) {
    const sample = uncountedNames.slice(0, 5).join(", ");
    banners.push(
      `${uncountedNames.length} bahan tidak ikut dihitung di opname ${opnameWithin.periodLabel} (${sample}${uncountedNames.length > 5 ? ", dll" : ""}). Stok akhirnya dianggap 0 — masukkan bahan ini ke opname berikutnya.`,
    );
  }

  // Sort by section then name
  rows.sort((a, b) => {
    const sa = a.section ?? "zzz";
    const sb = b.section ?? "zzz";
    if (sa !== sb) return sa.localeCompare(sb);
    return a.name.localeCompare(b.name);
  });

  return {
    period,
    outletName: outlet?.name ?? "Mahakan",
    rows,
    summary: summarizeCogs(rows),
    banners,
    usageComputable,
    lastOpname: {
      before: opnameBefore
        ? {
            id: opnameBefore.sessionId,
            periodLabel: opnameBefore.periodLabel,
            finalizedAt: opnameBefore.finalizedAt.toISOString(),
            countedAt: jakartaIsoDate(opnameBefore.countedAt),
          }
        : null,
      within: opnameWithin
        ? {
            id: opnameWithin.sessionId,
            periodLabel: opnameWithin.periodLabel,
            finalizedAt: opnameWithin.finalizedAt.toISOString(),
            countedAt: jakartaIsoDate(opnameWithin.countedAt),
          }
        : null,
    },
    purchaseStats: {
      activeCount: activePurchaseCount,
      cancelledCount: cancelledPurchaseCount,
    },
  };
}
