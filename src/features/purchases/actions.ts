"use server";

import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountingPeriods,
  expenseCategories,
  expenses,
  goodsReceipts,
  goodsReceiptItems,
  ingredientCostHistory,
  ingredients,
  inventoryMovements,
  journalEntries,
  journalLines,
  purchaseItems,
  purchaseRequestItems,
  purchaseRequests,
  purchases,
  supplierIngredients,
  suppliers,
} from "@/db/schema";
import { computeNewWac } from "@/features/cogs/cogs-calc";
import { cascadeCostUpdate } from "@/features/inventory/preparation-flow";
import { getStockMode } from "@/features/inventory/flag";
import {
  applyPrReceiveDelta,
  computePrStatus,
} from "@/features/purchase-requests/group-items-pure";
import { fetchLastFinalizedOpname } from "@/features/stock-opname/queries";
import { planGrMirror } from "./gr-mirror-pure";
/* Sesi AE-216 — uang satu baris pembelian = Total Bayar dari nota. */
import { isLineTotalConsistent, resolveLineTotal } from "./line-total";
import { toJakartaDateOnly } from "@/lib/date";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import {
  computeNewStock,
  formatMovementDelta,
} from "@/lib/stock-decimal";
import {
  classifyPurchaseAgainstOpname,
  convertPurchaseQty,
  mergePackConversions,
  resolveQtyToMaster,
  shouldSkipStockUpdate,
  type BackdateStatus,
  type PackInfo,
} from "@/lib/unit-conversion";
import { buildPurchaseLabel, labelMetodeBayar } from "./journal-label";
import {
  cancelPurchaseSchema,
  createPurchaseSchema,
  markPaidSchema,
  updatePaymentMethodSchema,
  updatePurchaseOrderSchema,
} from "./schemas";
import {
  fetchPurchaseById,
  fetchPurchaseDetail,
  fetchPurchases,
  fetchTopHistory,
  fetchTopOutstanding,
} from "./queries";
import {
  fail,
  ok,
  type ApiResult,
  type CancelPurchaseInput,
  type CreatePurchaseInput,
  type ListPurchasesOptions,
  type MarkPaidInput,
  type PaymentMethod,
  type Purchase,
  type PurchaseDetail,
  type PurchaseListItem,
  type TopHistoryItem,
  type TopHistoryOptions,
  type TopHistorySummary,
  type TopOutstandingItem,
  type UpdatePurchaseOrderInput,
  type UpdatePurchaseOrderResult,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/**
 * Map purchase payment_method → expense payment_method enum (cash/transfer/other).
 * Owner's bank-level distinction (BCA/BRI) flattened to "transfer" because expense
 * schema only has 3 values. Bank account stamped in expense.description.
 */
function expensePaymentMethod(m: PaymentMethod): "cash" | "transfer" | "other" {
  switch (m) {
    case "cash":
      return "cash";
    case "transfer_bca":
    case "transfer_bri":
    case "transfer_other":
      return "transfer";
    case "top":
      return "other";
  }
}

/** Satu sumber label metode bayar (dipakai audit log + deskripsi kas). */
function paymentMethodLabel(m: PaymentMethod): string {
  return labelMetodeBayar(m);
}

/**
 * Nama supplier untuk deskripsi entri kas. Query lepas dari transaksi —
 * tabel suppliers tidak disentuh alur pembelian, jadi aman dibaca dari
 * koneksi utama meski dipanggil di dalam `tx`.
 */
async function resolveSupplierName(
  supplierId: string | null | undefined,
): Promise<string | null> {
  if (!supplierId) return null;
  const [row] = await db
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .limit(1);
  return row?.name ?? null;
}

/**
 * Label pembelian untuk deskripsi jurnal — dipakai SEMUA hook jurnal
 * pembelian supaya Buku Besar menyebut nama supplier, bukan potongan UUID
 * (dulu: "Bayar hutang purchase 376b5626"). Satu query kecil per posting
 * jurnal (write-path saja, tidak menambah beban read).
 */
async function resolvePurchaseLabel(
  purchaseId: string,
  opts?: { receiptDate?: string | null },
): Promise<string> {
  const [row] = await db
    .select({
      invoiceNo: purchases.invoiceNo,
      purchaseDate: purchases.purchaseDate,
      supplierName: suppliers.name,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(eq(purchases.id, purchaseId))
    .limit(1);

  return buildPurchaseLabel({
    supplierName: row?.supplierName ?? null,
    invoiceNo: row?.invoiceNo ?? null,
    purchaseDate: row?.purchaseDate ? String(row.purchaseDate) : null,
    receiptDate: opts?.receiptDate ?? null,
  });
}

function todayJakartaIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// Reads
// ============================================================================

export async function listPurchases(
  opts: ListPurchasesOptions = {},
): Promise<ApiResult<PurchaseListItem[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat pembelian");
  }
  return ok(await fetchPurchases(session.user.outletId, opts));
}

export async function getPurchase(
  id: string,
): Promise<ApiResult<PurchaseDetail | null>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat pembelian");
  }
  return ok(await fetchPurchaseDetail(id, session.user.outletId));
}

/**
 * Sesi AE-184 — riwayat hutang dagang lengkap (lunas + belum + batal).
 * `listTopOutstanding` di bawah tetap ada untuk widget ringkas yang memang
 * hanya butuh yang belum lunas.
 */
export async function listTopHistory(
  opts: TopHistoryOptions = {},
): Promise<ApiResult<{ items: TopHistoryItem[]; summary: TopHistorySummary }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat hutang dagang");
  }
  return ok(
    await fetchTopHistory(session.user.outletId, todayJakartaIso(), opts),
  );
}

export async function listTopOutstanding(): Promise<
  ApiResult<TopOutstandingItem[]>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat hutang dagang");
  }
  return ok(
    await fetchTopOutstanding(session.user.outletId, todayJakartaIso()),
  );
}

// ============================================================================
// Create purchase (heaviest action — TX with multiple movements + expense)
// ============================================================================

export async function createPurchase(
  input: CreatePurchaseInput,
): Promise<
  ApiResult<{
    id: string;
    totalAmount: number;
    movementsCreated: number;
    /** Sesi AE-130 — backdate status untuk feedback ke UI. Kalau
     * "before" atau "same", stock TIDAK ditambah karena sudah ter-cover
     * di opname terakhir; UI tampilkan toast info supaya staff tahu. */
    backdateStatus: BackdateStatus;
    skippedStockUpdate: boolean;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.create")) {
    return fail("FORBIDDEN", "Tidak punya hak buat pembelian");
  }
  const parsed = createPurchaseSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  // Default createKasEntry: true for non-TOP, false for TOP.
  const shouldCreateKas =
    v.createKasEntry ?? (v.paymentMethod !== "top");

  const isTop = v.paymentMethod === "top";
  const dueDate = isTop
    ? addDaysIso(v.purchaseDate, v.paymentTermDays)
    : null;

  let resultId: string;
  let totalAmount = 0;
  let movementsCreated = 0;
  /* Sesi AE-130 — captured in TX, surfaced di return supaya UI bisa
   * tampilkan banner/toast khusus untuk backdated purchase. */
  let backdateStatusOut: BackdateStatus = "no_baseline";
  let skippedStockUpdateOut = false;

  try {
    const result = await db.transaction(async (tx) => {
      // Lock all impacted ingredients up front + verify outlet match.
      // Drizzle's sql\`= ANY(${arr})\` interpolates JS arrays as multiple
      // bind params (`$1, $2, ...`) which Postgres rejects inside ANY().
      // Use the inArray helper which generates a proper `IN (...)` clause.
      const ingIds = v.items.map((i) => i.ingredientId);
      const ingRows = await tx
        .select()
        .from(ingredients)
        .where(
          and(inArray(ingredients.id, ingIds), isNull(ingredients.deletedAt)),
        )
        .for("update");
      const ingById = new Map(ingRows.map((r) => [r.id, r] as const));
      for (const item of v.items) {
        const row = ingById.get(item.ingredientId);
        if (!row) throw new Error("INGREDIENT_NOT_FOUND");
        if (row.outletId !== session.user.outletId) {
          throw new Error("OUTLET_MISMATCH");
        }
      }

      /* Sesi AE-43 — batch query supplier_ingredients buat resolve pack
       * info ("1 Pack = X gr") yang dipakai convertPurchaseQty saat staff
       * input discrete unit (Pack/Karton/Btl) untuk bahan yang master-nya
       * continuous (gr/ml). Soft-delete aware + outlet-scoped.
       *
       * Skip kalau pembelian langsung (supplierId null) — Market List
       * memang per-supplier; untuk direct purchase staff harus pakai
       * unit sejenis dengan master (Kg/gr, L/ml). */
      const packMap = new Map<string, PackInfo>();
      if (v.supplierId) {
        const packRows = await tx
          .select({
            ingredientId: supplierIngredients.ingredientId,
            packSize: supplierIngredients.packSize,
            packUnit: supplierIngredients.packUnit,
          })
          .from(supplierIngredients)
          .where(
            and(
              eq(supplierIngredients.outletId, session.user.outletId),
              eq(supplierIngredients.supplierId, v.supplierId),
              inArray(supplierIngredients.ingredientId, ingIds),
              isNull(supplierIngredients.deletedAt),
            ),
          );
        for (const r of packRows) {
          const size = parseFloat(r.packSize);
          if (Number.isFinite(size) && size > 0) {
            packMap.set(r.ingredientId, {
              packSize: size,
              packUnit: r.packUnit,
            });
          }
        }
      }

      /* Sesi AE-43 — pre-resolve conversion buat semua item DULU (sebelum
       * write apapun) supaya kalau ada satu item yang invalid, transaction
       * fail tanpa partial side-effects. Hasil di-stash buat dipakai di
       * loop write berikut. */
      const resolved = v.items.map((item) => {
        const ing = ingById.get(item.ingredientId)!;
        /* Sesi AE-130 — multi-unit tier (Anisa feedback). Merge
         * ingredient.unitBelanja & unitTracking sebagai SYNTHETIC pack
         * entries supaya convertPurchaseQty bisa resolve label custom
         * (mis. "Kotak", "Karung") tanpa harus duplicate ke packConversions
         * jsonb. Same-dimension labels (L, Kg) tetap auto-handled via
         * UNIT_TABLE; ini extension untuk discrete tier labels. */
        const existingPacks =
          (ing.packConversions as
            | Array<{ unitLabel: string; qtyPerBase: number }>
            | null) ?? [];
        const tierPacks: Array<{ unitLabel: string; qtyPerBase: number }> = [];
        if (ing.unitBelanja && ing.unitBelanjaPerCogs) {
          const per = parseFloat(ing.unitBelanjaPerCogs);
          if (Number.isFinite(per) && per > 0) {
            tierPacks.push({
              unitLabel: ing.unitBelanja,
              qtyPerBase: per,
            });
          }
        }
        if (ing.unitTracking && ing.unitTrackingPerCogs) {
          const per = parseFloat(ing.unitTrackingPerCogs);
          if (Number.isFinite(per) && per > 0) {
            tierPacks.push({
              unitLabel: ing.unitTracking,
              qtyPerBase: per,
            });
          }
        }
        const mergedPacks = mergePackConversions(existingPacks, tierPacks);

        const res = convertPurchaseQty({
          qty: item.qty,
          fromUnit: item.unit ?? ing.unit,
          masterUnit: ing.unit,
          pack: packMap.get(item.ingredientId) ?? null,
          ingredientPacks: mergedPacks,
        });
        if (!res.ok) {
          throw new Error(`UNIT_ERROR:${ing.name}:${res.message}`);
        }
        return { item, ing, res };
      });

      /* Sesi AE-57 — PR linkage: lock + validate PR items referenced di
       * items[].purchaseRequestItemId. Per-item:
       *  1. PR item exists + owner outlet match
       *  2. PR.status != cancelled
       *  3. PR item belum di-reject
       * Sesi AE-177: anti-over-receive guard DIHAPUS — owner boleh beli
       *   lebih/kurang dari request staff; disparity tercatat di PR.
       * Output: map prItemId → currentRow untuk post-loop receivedQty bump. */
      const prItemIds = v.items
        .map((i) => i.purchaseRequestItemId)
        .filter((id): id is string => Boolean(id));
      const prItemMap = new Map<string, typeof purchaseRequestItems.$inferSelect>();
      const prHeaderMap = new Map<string, typeof purchaseRequests.$inferSelect>();
      if (prItemIds.length > 0) {
        const prItemRows = await tx
          .select()
          .from(purchaseRequestItems)
          .where(inArray(purchaseRequestItems.id, prItemIds))
          .for("update");
        for (const row of prItemRows) prItemMap.set(row.id, row);

        // Fetch PR headers untuk validasi outlet + status
        const prIds = Array.from(new Set(prItemRows.map((r) => r.requestId)));
        if (prIds.length > 0) {
          const prRows = await tx
            .select()
            .from(purchaseRequests)
            .where(inArray(purchaseRequests.id, prIds));
          for (const row of prRows) prHeaderMap.set(row.id, row);
        }

        /* Feedback Cacil 2026-06-12 (audit lanjutan) — guard server anti
         * dobel-tarik. Filter "outstanding" di modal Tarik hanya level
         * tampilan; tab basi / dua device bisa tetap submit item yang sudah
         * dibeli atau sudah dalam PO aktif → link dobel + bump dobel.
         * Row PR di-lock FOR UPDATE di atas → dua submit bersamaan serial,
         * yang kedua kena guard ini. */
        const linkedRows = await tx
          .select({ prItemId: purchaseItems.purchaseRequestItemId })
          .from(purchaseItems)
          .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
          .where(
            and(
              inArray(purchaseItems.purchaseRequestItemId, prItemIds),
              ne(purchases.status, "cancelled"),
            ),
          );
        const alreadyLinked = new Set(
          linkedRows.map((r) => r.prItemId).filter(Boolean),
        );

        // Validate each linked item
        /* Sesi AE-177 — keputusan owner: qty pembelian boleh LEBIH/KURANG
         * dari yang di-request staff (pertimbangan pasar/promo ada di
         * tangan Purchasing). Disparity tercatat di PR (requestedQty)
         * vs actual receivedQty. Item dianggap beres begitu received > 0
         * (under-buy = keputusan final owner, feedback Anisa 2026-06-08).
         * (Sebelumnya: throw PR_OVER_RECEIVE → blok save.) */
        for (const { item, ing } of resolved) {
          if (!item.purchaseRequestItemId) continue;
          const prItem = prItemMap.get(item.purchaseRequestItemId);
          if (!prItem) throw new Error("PR_ITEM_NOT_FOUND");
          const pr = prHeaderMap.get(prItem.requestId);
          if (!pr) throw new Error("PR_NOT_FOUND");
          if (pr.outletId !== session.user.outletId) {
            throw new Error("OUTLET_MISMATCH");
          }
          if (pr.status === "cancelled") {
            throw new Error(`PR_CANCELLED:${ing.name}`);
          }
          if (prItem.rejectedAt) {
            throw new Error(`PR_ITEM_REJECTED:${ing.name}`);
          }
          if (Number(prItem.receivedQty) > 0) {
            throw new Error(`PR_ITEM_ALREADY_BOUGHT:${ing.name}`);
          }
          if (alreadyLinked.has(item.purchaseRequestItemId)) {
            throw new Error(`PR_ITEM_ALREADY_LINKED:${ing.name}`);
          }
        }
      }

      // Compute total. Sesi AE — qty boleh decimal (mis. 0.5 kg × Rp 10.000),
      // jadi pakai floating math + round ke nearest rupiah di akhir per-line
      // untuk konsistensi sama UI live preview.
      // Sesi AE-43 — totalCost tetap pakai raw qty × raw unitCost supaya
      // rupiah identik dengan apa yang owner liat di nota; conversion
      // hanya dipakai untuk stock + cost master.
      /* Sesi AE-216 — total dihitung dari TOTAL BAYAR tiap baris, bukan
       * `qty × harga`. Harga satuan wajib rupiah bulat, jadi mengalikannya
       * balik membuang sisa pembulatan dan nota Rp 227.000 tercatat
       * Rp 226.880 — kas & jurnal ikut meleset dari struk.
       *
       * Rem kewajaran dijalankan DULU untuk semua baris: `totalCost` yang
       * tidak berpasangan dengan qty × harga di barisnya sendiri ditolak,
       * supaya kolom uang tidak bisa diisi angka sembarang. */
      for (const item of v.items) {
        if (!isLineTotalConsistent(item)) {
          const ing = ingById.get(item.ingredientId);
          throw new Error(`LINE_TOTAL_MISMATCH:${ing?.name ?? "bahan"}`);
        }
      }
      let total = 0;
      for (const item of v.items) {
        total += resolveLineTotal(item);
      }

      /* Sesi AE-130 — anti-double-count detection (Anisa feedback).
       *
       * Fetch opname finalized terakhir di outlet ini. Kalau purchase_date
       * <= opname.finalizedAt date (Jakarta TZ), berarti stock fisik sudah
       * include belanja ini → SKIP per-item stock + WAC update untuk
       * mencegah double-count. Movement tetap di-record dengan flag
       * `skippedStockUpdate=true` supaya audit trail jelas + COGS report
       * tetap show purchase qty/value periode.
       *
       * Fallback aman: kalau outlet belum punya opname finalized (Mahakan
       * baru 3 minggu — sesi AE-130 launch context), classify returns
       * "no_baseline" → normal additive behavior, no warning. Begitu
       * opname pertama finalized, logic kick-in otomatis. */
      const lastOpname = await fetchLastFinalizedOpname(
        session.user.outletId,
      );
      const backdateStatus: BackdateStatus = classifyPurchaseAgainstOpname({
        purchaseDateIso: v.purchaseDate,
        lastOpnameFinalizedAt: lastOpname?.finalizedAt ?? null,
      });
      const skipStockUpdate = shouldSkipStockUpdate(backdateStatus);
      backdateStatusOut = backdateStatus;
      skippedStockUpdateOut = skipStockUpdate;

      /* Sesi AE-173 — mode periodic (addOnPurchase=false): pembelian TIDAK
       * menambah stok/WAC. Diperlakukan seperti skip-stock (anti-double-count):
       * stok/WAC/cost-history di-skip, movement di-flag skippedStockUpdate,
       * TAPI baris pembelian + expense (pencatatan pengeluaran) tetap dibuat.
       * Reversibel: nyalakan lagi via toggle kapan saja. */
      const { addOnPurchase } = await getStockMode(session.user.outletId);
      const skipStockEffect = skipStockUpdate || !addOnPurchase;

      // Sesi AE-129 — multi-nota. UI baru kirim `receiptImageUrls`. Legacy
       // single URL field di-mirror dengan item pertama dari array supaya
       // existing list/detail views (yang masih baca receiptImageUrl) tetap
       // work tanpa migrasi data. Kalau cuma `receiptImageUrl` legacy yang
       // dikirim (client lama), wrap jadi single-element array.
      const urlsRaw = v.receiptImageUrls ?? null;
      const legacyUrl = v.receiptImageUrl ?? null;
      const receiptImageUrls =
        urlsRaw && urlsRaw.length > 0
          ? urlsRaw
          : legacyUrl
            ? [legacyUrl]
            : null;
      const receiptImageUrl =
        receiptImageUrls && receiptImageUrls.length > 0
          ? receiptImageUrls[0]
          : null;

      // Insert header.
      const [created] = await tx
        .insert(purchases)
        .values({
          outletId: session.user.outletId,
          supplierId: v.supplierId,
          /* Sesi AE-177 — persist link PR sumber (cross-surface PR↔PO). */
          fromPurchaseRequestId: v.fromPurchaseRequestId ?? null,
          purchaseDate: v.purchaseDate,
          paymentMethod: v.paymentMethod,
          paymentTermDays: v.paymentTermDays,
          dueDate,
          invoiceNo: v.invoiceNo ?? null,
          notes: v.notes ?? null,
          receiptImageUrl,
          receiptImageUrls,
          status: isTop ? "pending_payment" : "paid",
          /* Instant purchase = barang sudah di tangan → stempel diterima
           * (sesi AE-177, konsisten dgn jalur GR). receiptStatus default
           * 'received'. */
          receivedAt: new Date(),
          totalAmount: total,
          paidAt: isTop ? null : new Date(),
          paidBy: isTop ? null : session.user.id,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        })
        .returning();
      if (!created) throw new Error("INSERT_FAILED");

      // Per item: insert purchase_items + inventory_movements + update stock.
      // Sesi AE — qty boleh decimal. Sesi AE-12 — stock counter sekarang
      // tracking decimal precision via current_stock_decimal kolom. bigint
      // tetap di-write rounded sebagai backward-compat. inventory_movements
      // qty_delta_decimal mirrors decimal delta (signed).
      //
      // Sesi AE-43 — qty di inventory_movements + ingredients.current_stock
      // SUDAH di-convert ke master unit (lewat convertPurchaseQty). Cost
      // master juga di-scale per master unit. purchase_items SIMPAN RAW
      // input staff (qty + unitCost + totalCost) — total rupiah identik
      // dengan apa yang di-display ke owner.
      /* Sesi AE-177 — kumpulkan baris untuk catatan GR kanonik. Instant
       * purchase = barang langsung diterima → harus muncul di tab GR (log
       * lengkap, konsisten dgn jalur PO→GR). */
      const grItemRows: Array<{
        purchaseItemId: string;
        ingredientId: string;
        receivedQty: number;
        receivedQtyDecimal: string;
        unitCost: number;
        totalCost: number;
        movementId: string;
        ingredientNameSnapshot: string;
        unitSnapshot: string;
        sectionSnapshot: string | null;
      }> = [];
      for (const { item, ing, res } of resolved) {
        /* Sesi AE-216 — uang baris ini = Total Bayar dari nota (lihat
         * line-total.ts). Cost master & WAC di bawah tetap memakai
         * `unitCostMaster`, jadi HPP tidak ikut bergeser. */
        const totalCost = resolveLineTotal(item);
        const qtyDecimalStr = item.qty.toFixed(4); // raw input
        const unitOverride = item.unit?.trim() || null;

        const qtyMaster = res.qtyMaster;
        const costFactor = res.costFactor;
        // unitCost (Rp per master-unit). Untuk no-op path (costFactor=1)
        // identik dengan raw unitCost — backward-compat untuk ingredient
        // yang sudah konsisten unit-nya.
        const unitCostMaster = Math.max(
          0,
          Math.round(item.unitCost / costFactor),
        );

        const newStock = computeNewStock({
          currentBigint: ing.currentStock,
          currentDecimal: ing.currentStockDecimal,
          delta: qtyMaster,
        });
        const movementDelta = formatMovementDelta(qtyMaster);

        // Sesi AE-115 — Auto WAC (Weighted Average Cost). Sebelumnya
        // costPerUnit di-overwrite dengan unitCostMaster (latest price).
        // Sekarang: hitung running WAC supaya cost reflect blended price
        // across all purchases, sesuai accounting standard.
        //
        //   effectiveOldQty = max(0, currentStockDecimal)
        //   oldValue = effectiveOldQty × oldCost
        //   newQty   = effectiveOldQty + qtyMaster
        //   newCost  = (oldValue + totalCostMaster) / newQty
        //
        // Caller bisa disable via v.updateCost=false (rare; e.g. pembelian
        // one-off untuk acara, tidak mau pollute master cost).
        const oldQtyDecimal = Number(ing.currentStockDecimal ?? 0);
        const oldCostBefore = ing.costPerUnit;
        const totalCostMaster = Math.round(qtyMaster * unitCostMaster);

        let newWacCost = oldCostBefore;
        if (v.updateCost && !skipStockEffect) {
          const wac = computeNewWac({
            oldQty: oldQtyDecimal,
            oldCost: oldCostBefore,
            purchaseQty: qtyMaster,
            purchaseTotal: totalCostMaster,
          });
          newWacCost = wac.newCost;
        }
        const costChanged =
          v.updateCost && !skipStockEffect && newWacCost !== oldCostBefore;

        /* Sesi AE-130 — kalau backdated (skipStockUpdate=true): JANGAN
         * touch currentStock/currentStockDecimal/costPerUnit. Stock fisik
         * sudah ter-cover di opname terakhir; nambah lagi = double count.
         * WAC juga skipped — kalau update tanpa update stock, formula
         * (oldValue + newValue) / (oldQty + newQty) jadi tidak konsisten.
         * Audit tetap full: cost history + movement keep ter-record.
         *
         * updatedAt/updatedBy juga di-skip — ingredient state effectively
         * tidak berubah dari sisi domain. */
        if (!skipStockEffect) {
          const updateValues: Record<string, unknown> = {
            currentStock: newStock.bigint,
            currentStockDecimal: newStock.decimal,
            updatedAt: new Date(),
            updatedBy: session.user.id,
          };
          if (v.updateCost) {
            updateValues.costPerUnit = newWacCost;
            if (costChanged) {
              updateValues.costLastChangedAt = new Date();
            }
          }
          await tx
            .update(ingredients)
            .set(updateValues)
            .where(eq(ingredients.id, item.ingredientId));
        }

        // Insert cost history (audit trail) — only kalau cost berubah.
        // Cascade ke preparation recipes yang depend on this ingredient
        // supaya prep cost ikut update.
        if (costChanged) {
          await tx.insert(ingredientCostHistory).values({
            outletId: session.user.outletId,
            ingredientId: item.ingredientId,
            oldCostPerUnit: oldCostBefore,
            newCostPerUnit: newWacCost,
            triggerType: "purchase_wac",
            triggerRefType: "purchase",
            triggerRefId: created.id,
            changedQty: qtyMaster.toFixed(4),
            changedValue: totalCostMaster,
            actorId: session.user.id,
            notes: `Purchase ${v.invoiceNo ?? created.id.slice(0, 8)} — unit cost ${unitCostMaster}`,
          });
          // Cascade fail-soft: catch supaya purchase tetap commit kalau
          // cascade error (mis. preparation recipe corrupt). Cost history
          // di atas tetap recorded sebagai audit trail.
          try {
            await cascadeCostUpdate(
              tx,
              session.user.outletId,
              item.ingredientId,
              session.user.id,
            );
          } catch {
            // Silent — cost history sudah recorded, manual recompute via UI.
          }
        }

        // Movement. Sesi AE-130 — flag skippedStockUpdate kalau backdated,
        // supaya audit + COGS report bisa membedakan "purchase yang
        // mempengaruhi stock" vs "purchase yang sudah ter-cover di opname"
        // tanpa kehilangan transactional history.
        const [movement] = await tx
          .insert(inventoryMovements)
          .values({
            outletId: session.user.outletId,
            ingredientId: item.ingredientId,
            kind: "purchase",
            qtyDelta: movementDelta.bigint,
            qtyDeltaDecimal: movementDelta.decimal,
            unitCostAtMovement: unitCostMaster,
            referenceType: "manual",
            referenceId: created.id,
            reason: (() => {
              const label = v.invoiceNo ?? created.id.slice(0, 8);
              const note = skipStockEffect
                ? skipStockUpdate
                  ? " (backdate, no stock add)"
                  : " (periodic, no stock add)"
                : "";
              return `Purchase ${label}${note}`;
            })(),
            skippedStockUpdate: skipStockEffect,
            createdBy: session.user.id,
          })
          .returning({ id: inventoryMovements.id });

        // Item — qty bigint = rounded RAW staff input (matches purchase
        // nota for owner audit). qtyDecimal = exact raw. unitCost +
        // totalCost = raw rupiah (no scale). movement.qtyDeltaDecimal
        // adalah source of truth untuk stock — purchase_items adalah
        // jurnal nota / kas.
        const rawQtyBigint = Math.max(1, Math.round(item.qty));
        const [pi] = await tx
          .insert(purchaseItems)
          .values({
            purchaseId: created.id,
            ingredientId: item.ingredientId,
            qty: rawQtyBigint,
            qtyDecimal: qtyDecimalStr,
            // Sesi AE-173 — instant purchase = langsung diterima penuh.
            receivedQty: rawQtyBigint,
            receivedQtyDecimal: qtyDecimalStr,
            unitCost: item.unitCost,
            totalCost,
            movementId: movement.id,
            ingredientNameSnapshot: ing.name,
            unitSnapshot: ing.unit,
            unitOverride,
            sectionSnapshot: ing.section,
            purchaseRequestItemId: item.purchaseRequestItemId ?? null,
          })
          .returning({ id: purchaseItems.id });

        grItemRows.push({
          purchaseItemId: pi!.id,
          ingredientId: item.ingredientId,
          receivedQty: rawQtyBigint,
          receivedQtyDecimal: qtyDecimalStr,
          unitCost: item.unitCost,
          totalCost,
          movementId: movement.id,
          ingredientNameSnapshot: ing.name,
          unitSnapshot: ing.unit,
          sectionSnapshot: ing.section,
        });

        movementsCreated++;
      }

      /* Sesi AE-57 — post-loop: bump receivedQty di PR items + auto-promote
       * PR status (open → partial → completed). Group by requestId supaya
       * status update per-PR cuma sekali (efficient + atomic). */
      if (prItemIds.length > 0) {
        const bumpByRequest = new Map<
          string,
          Array<{ prItemId: string; addQty: number; addQtyDecimal: number }>
        >();
        for (const { item, res } of resolved) {
          if (!item.purchaseRequestItemId) continue;
          const prItem = prItemMap.get(item.purchaseRequestItemId);
          if (!prItem) continue;
          const addQty = Math.max(1, Math.round(res.qtyMaster));
          const list = bumpByRequest.get(prItem.requestId) ?? [];
          list.push({
            prItemId: prItem.id,
            addQty,
            addQtyDecimal: res.qtyMaster,
          });
          bumpByRequest.set(prItem.requestId, list);
        }

        for (const [requestId, bumps] of bumpByRequest) {
          // Update each PR item receivedQty (additive)
          for (const b of bumps) {
            const prItem = prItemMap.get(b.prItemId)!;
            const newReceivedQty = Number(prItem.receivedQty) + b.addQty;
            const currentDecimal = prItem.receivedQtyDecimal
              ? Number(prItem.receivedQtyDecimal)
              : 0;
            const newDecimal = (currentDecimal + b.addQtyDecimal).toFixed(4);
            await tx
              .update(purchaseRequestItems)
              .set({
                receivedQty: newReceivedQty,
                receivedQtyDecimal: newDecimal,
                updatedAt: new Date(),
              })
              .where(eq(purchaseRequestItems.id, b.prItemId));
            // Update in-memory snapshot supaya status compute pakai data terbaru
            prItemMap.set(b.prItemId, {
              ...prItem,
              receivedQty: newReceivedQty,
              receivedQtyDecimal: newDecimal,
            });
          }

          // Re-fetch ALL items for this PR (untuk hitung status accurate)
          const allItems = await tx
            .select()
            .from(purchaseRequestItems)
            .where(eq(purchaseRequestItems.requestId, requestId));
          const newStatus = computePrStatus(
            allItems.map((r) => ({
              requestedQty: Number(r.requestedQty),
              receivedQty: Number(r.receivedQty),
              rejectedAt: r.rejectedAt,
            })),
          );
          const pr = prHeaderMap.get(requestId)!;
          const updates: Record<string, unknown> = { updatedAt: new Date() };
          if (newStatus !== pr.status && newStatus !== "cancelled") {
            updates.status = newStatus;
            if (newStatus === "completed") {
              updates.completedAt = new Date();
            }
          }
          await tx
            .update(purchaseRequests)
            .set(updates)
            .where(eq(purchaseRequests.id, requestId));
        }
      }

      // Optional: auto-create kas expense.
      let expenseId: string | null = null;
      if (shouldCreateKas && !isTop) {
        // Find/create default expense category "Pembelanjaan" (or fallback).
        const [defaultCat] = await tx
          .select()
          .from(expenseCategories)
          .where(
            and(
              eq(expenseCategories.outletId, session.user.outletId),
              isNull(expenseCategories.deletedAt),
            ),
          )
          .orderBy(asc(expenseCategories.displayOrder))
          .limit(1);

        if (defaultCat) {
          const [exp] = await tx
            .insert(expenses)
            .values({
              outletId: session.user.outletId,
              expenseDate: v.purchaseDate,
              categoryId: defaultCat.id,
              description: `Belanja ${paymentMethodLabel(v.paymentMethod)} — ${buildPurchaseLabel(
                {
                  supplierName: await resolveSupplierName(v.supplierId),
                  invoiceNo: v.invoiceNo,
                  purchaseDate: v.purchaseDate,
                },
              )}${v.notes ? ` · ${v.notes}` : ""}`,
              amount: total,
              paymentMethod: expensePaymentMethod(v.paymentMethod),
              /* Sesi AE-79 — sourceType='purchase' (default 'manual') supaya:
               *   1. Expense filter di laporan benar (purchase expenses tidak
               *      ke-mix dengan manual entry).
               *   2. Soft FK purchaseId ↔ purchase.expenseId symmetric.
               *   3. Future-safe: kalau expense_delete suatu hari fire reverse
               *      journal hook, sourceType check di hooks.ts:1182
               *      (`if exp.sourceType !== "manual" return`) skip dengan
               *      benar — sebelumnya purchase expense tagged 'manual' →
               *      bisa fire reverse journal yg konflik dengan purchase
               *      journal. */
              sourceType: "purchase",
              purchaseId: created.id,
              createdBy: session.user.id,
            })
            .returning({ id: expenses.id });
          expenseId = exp.id;

          await tx
            .update(purchases)
            .set({ expenseId })
            .where(eq(purchases.id, created.id));
        }
        // Kalau tidak ada category sama sekali, skip silently — Owner setup kas dulu.
      }

      /* Sesi AE-177 — catatan GR kanonik untuk instant purchase. Mirror data
       * yang baru ditulis (movement/cost sudah dihitung); tidak menyentuh logika
       * stok/WAC/jurnal di atas. expenseId = expense yang sama (NULL utk TOP).
       * Tab GR kini menampilkan SEMUA barang masuk (instant + PO→GR). */
      if (grItemRows.length > 0) {
        const [gr] = await tx
          .insert(goodsReceipts)
          .values({
            outletId: session.user.outletId,
            purchaseId: created.id,
            receivedDate: v.purchaseDate,
            totalAmount: total,
            expenseId,
            createdBy: session.user.id,
          })
          .returning({ id: goodsReceipts.id });
        for (const r of grItemRows) {
          await tx.insert(goodsReceiptItems).values({
            goodsReceiptId: gr!.id,
            purchaseItemId: r.purchaseItemId,
            ingredientId: r.ingredientId,
            receivedQty: r.receivedQty,
            receivedQtyDecimal: r.receivedQtyDecimal,
            unitCost: r.unitCost,
            totalCost: r.totalCost,
            movementId: r.movementId,
            ingredientNameSnapshot: r.ingredientNameSnapshot,
            unitSnapshot: r.unitSnapshot,
            sectionSnapshot: r.sectionSnapshot,
          });
        }
      }

      return { created, total };
    });

    resultId = result.created.id;
    totalAmount = result.total;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "INGREDIENT_NOT_FOUND")
      return fail("NOT_FOUND", "Salah satu bahan tidak ditemukan / non-aktif");
    if (msg === "OUTLET_MISMATCH")
      return fail("FORBIDDEN", "Bahan dari outlet lain — kontak admin");
    if (msg.startsWith("UNIT_ERROR:")) {
      // Format: UNIT_ERROR:<ingredientName>:<userMessage>
      const rest = msg.slice("UNIT_ERROR:".length);
      const sep = rest.indexOf(":");
      const ingName = sep > 0 ? rest.slice(0, sep) : "?";
      const userMsg = sep > 0 ? rest.slice(sep + 1) : rest;
      return fail("VALIDATION_ERROR", `Bahan "${ingName}": ${userMsg}`);
    }
    /* Sesi AE-216 — Total Bayar yang tidak berpasangan dengan qty × harga
     * di barisnya sendiri. Biasanya salah ketik (mis. kelebihan nol). */
    if (msg.startsWith("LINE_TOTAL_MISMATCH:")) {
      const ingName = msg.slice("LINE_TOTAL_MISMATCH:".length);
      return fail(
        "VALIDATION_ERROR",
        `Bahan "${ingName}": Total Bayar tidak cocok dengan QTY × harga satuan. Cek lagi angkanya.`,
      );
    }
    /* Sesi AE-57 — PR-linked errors */
    if (msg === "PR_ITEM_NOT_FOUND") {
      return fail("NOT_FOUND", "Item Permintaan Belanja tidak ditemukan");
    }
    if (msg === "PR_NOT_FOUND") {
      return fail("NOT_FOUND", "Permintaan Belanja tidak ditemukan");
    }
    if (msg.startsWith("PR_CANCELLED:")) {
      const ingName = msg.slice("PR_CANCELLED:".length);
      return fail(
        "CONFLICT",
        `Bahan "${ingName}": Permintaan Belanja-nya sudah dibatalkan`,
      );
    }
    if (msg.startsWith("PR_ITEM_REJECTED:")) {
      const ingName = msg.slice("PR_ITEM_REJECTED:".length);
      return fail(
        "CONFLICT",
        `Bahan "${ingName}": item PR sudah ditolak, tidak bisa di-belikan`,
      );
    }
    /* Feedback Cacil 2026-06-12 — anti dobel-tarik (tab basi / race). */
    if (msg.startsWith("PR_ITEM_ALREADY_BOUGHT:")) {
      const ingName = msg.slice("PR_ITEM_ALREADY_BOUGHT:".length);
      return fail(
        "CONFLICT",
        `Bahan "${ingName}": item PR ini sudah pernah dibeli. Refresh halaman — kalau memang mau beli lagi, pakai Catat Pembelian biasa (tanpa tarik PR).`,
      );
    }
    if (msg.startsWith("PR_ITEM_ALREADY_LINKED:")) {
      const ingName = msg.slice("PR_ITEM_ALREADY_LINKED:".length);
      return fail(
        "CONFLICT",
        `Bahan "${ingName}": item PR ini sudah ditarik ke PO aktif (menunggu diterima). Refresh halaman untuk lihat status terbaru.`,
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "purchases.create", "Gagal menyimpan pembelian"),
    );
  }

  /* Sesi AE-57 — kalau purchase ini di-tarik dari PR, fire audit event
   * `purchase.create_from_pr` dengan PR ID + linked item count untuk
   * traceability di Audit Log. Selain itu tetap fire `purchase.create`
   * supaya existing dashboards + filter tidak break. */
  const prLinkedCount = v.items.filter((i) => i.purchaseRequestItemId).length;
  const fromPrId = v.fromPurchaseRequestId ?? null;

  await logAudit({
    eventType:
      fromPrId && prLinkedCount > 0 ? "purchase.create_from_pr" : "purchase.create",
    userId: session.user.id,
    entityType: "purchase",
    entityId: resultId,
    payload: {
      summary: `Purchase ${paymentMethodLabel(v.paymentMethod)} ${v.purchaseDate} (${v.items.length} item, total ${totalAmount})${
        fromPrId
          ? ` · dari PR ${fromPrId.slice(0, 8)} (${prLinkedCount} item ter-link)`
          : ""
      }`,
      context: {
        purchaseDate: v.purchaseDate,
        paymentMethod: v.paymentMethod,
        itemCount: v.items.length,
        totalAmount,
        autoExpense: shouldCreateKas && !isTop,
        fromPurchaseRequestId: fromPrId,
        prLinkedItemCount: prLinkedCount,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  // Sesi U — Accounting auto-journal hook (purchase create). Aggregate per
  // section from purchase_items snapshot (post-commit query — small overhead).
  {
    const items = await db
      .select({
        section: purchaseItems.sectionSnapshot,
        totalCost: purchaseItems.totalCost,
      })
      .from(purchaseItems)
      .where(eq(purchaseItems.purchaseId, resultId));

    const bySection = new Map<string, number>();
    for (const it of items) {
      const key = it.section ?? "null";
      bySection.set(key, (bySection.get(key) ?? 0) + Number(it.totalCost));
    }
    const sectionLines = Array.from(bySection.entries()).map(([key, amount]) => ({
      section: (key === "null" ? null : key) as
        | "kitchen"
        | "bar"
        | "supporting"
        | "cleaning"
        | null,
      amount,
    }));

    const { fireJournalHook, postJournalForPurchaseCreate } = await import(
      "@/features/accounting/hooks"
    );
    fireJournalHook(
      async () =>
        postJournalForPurchaseCreate({
          outletId: session.user.outletId,
          purchaseId: resultId,
          purchaseLabel: await resolvePurchaseLabel(resultId),
          paymentMethod: v.paymentMethod,
          total: totalAmount,
          lines: sectionLines,
          entryDate: v.purchaseDate,
          actorId: session.user.id,
        }),
      "purchase_create",
    );
  }

  return ok({
    id: resultId,
    totalAmount,
    movementsCreated,
    backdateStatus: backdateStatusOut,
    skippedStockUpdate: skippedStockUpdateOut,
  });
}

// ============================================================================
// Cancel purchase — reverses inventory movements + (kalau ada) expense
// ============================================================================

export async function cancelPurchase(
  input: CancelPurchaseInput,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.cancel")) {
    return fail(
      "FORBIDDEN",
      "Hanya manager / owner yang boleh cancel pembelian",
    );
  }
  const parsed = cancelPurchaseSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(purchases)
        .where(
          and(
            eq(purchases.id, v.id),
            eq(purchases.outletId, session.user.outletId),
          ),
        )
        .for("update")
        .limit(1);
      if (!p) throw new Error("NOT_FOUND");
      if (p.status === "cancelled") throw new Error("BAD_STATE");

      /* Sesi AE-173 — PO yang masih 'ordered' belum punya efek apa pun
       * (tidak ada stok/movement/expense/jurnal). Cukup set cancelled tanpa
       * reversal — mencegah reversal stok hantu. */
      if (p.receiptStatus === "ordered") {
        await tx
          .update(purchases)
          .set({
            status: "cancelled",
            receiptStatus: "cancelled",
            cancelledAt: new Date(),
            cancelledBy: session.user.id,
            cancelReason: v.reason,
            updatedAt: new Date(),
          })
          .where(eq(purchases.id, v.id));
        return;
      }

      /* Sesi AE-43 — reverse pakai `inventory_movements.qty_delta_decimal`
       * (master unit) via join `movementId`, BUKAN `purchase_items.qty_decimal`
       * (raw input staff). Untuk legacy purchase pre-AE-43 keduanya identik
       * (no conversion was applied), jadi backward-compat. Untuk purchase
       * baru dengan conversion: reverse harus pakai master-unit delta supaya
       * stock balance benar. */
      /* Sesi AE-177 — reverse SEMUA movement 'purchase' milik purchase ini
       * (by referenceId), BUKAN via purchase_items.movementId. Sebab: PO yang
       * diterima lewat BEBERAPA GR sebagian menulis >1 movement per item, tapi
       * purchase_items.movementId ke-overwrite ke movement TERAKHIR → join lama
       * cuma reverse GR terakhir → stok bocor. Iterasi per-movement aman utk
       * instant (1 movement/item) maupun multi-GR. */
      const purchaseMovements = await tx
        .select({
          id: inventoryMovements.id,
          ingredientId: inventoryMovements.ingredientId,
          qtyDeltaDecimal: inventoryMovements.qtyDeltaDecimal,
          unitCostAtMovement: inventoryMovements.unitCostAtMovement,
          skippedStockUpdate: inventoryMovements.skippedStockUpdate,
        })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.referenceId, v.id),
            eq(inventoryMovements.kind, "purchase"),
          ),
        );

      for (const mv of purchaseMovements) {
        /* Movement yang TIDAK menambah stok (backdate / periodic) → tidak ada
         * yang perlu dibalik. */
        if (mv.skippedStockUpdate) continue;

        const [ing] = await tx
          .select()
          .from(ingredients)
          .where(eq(ingredients.id, mv.ingredientId))
          .for("update")
          .limit(1);
        if (!ing) continue; // ingredient deleted — skip

        const parsed = parseFloat(mv.qtyDeltaDecimal ?? "");
        const reverseQty = Number.isFinite(parsed) ? parsed : 0;
        if (reverseQty === 0) continue;

        const newStock = computeNewStock({
          currentBigint: ing.currentStock,
          currentDecimal: ing.currentStockDecimal,
          delta: -reverseQty,
        });
        if (newStock.bigint < 0) throw new Error(`NEGATIVE_STOCK:${ing.name}`);
        await tx
          .update(ingredients)
          .set({
            currentStock: newStock.bigint,
            currentStockDecimal: newStock.decimal,
            updatedAt: new Date(),
            updatedBy: session.user.id,
          })
          .where(eq(ingredients.id, mv.ingredientId));

        // Counter-movement for traceability.
        const movementDelta = formatMovementDelta(-reverseQty);
        await tx.insert(inventoryMovements).values({
          outletId: session.user.outletId,
          ingredientId: mv.ingredientId,
          kind: "adjust",
          qtyDelta: movementDelta.bigint,
          qtyDeltaDecimal: movementDelta.decimal,
          unitCostAtMovement: mv.unitCostAtMovement ?? 0,
          referenceType: "manual",
          referenceId: v.id,
          reason: `Cancel purchase ${p.id.slice(0, 8)} — ${v.reason}`,
          createdBy: session.user.id,
        });
      }

      // Soft-cancel header (not delete — keep for audit).
      await tx
        .update(purchases)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledBy: session.user.id,
          cancelReason: v.reason,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(purchases.id, v.id));

      // Soft-delete linked expense kalau ada (Owner reconcile manual).
      if (p.expenseId) {
        await tx
          .update(expenses)
          .set({
            deletedAt: new Date(),
            deletedBy: session.user.id,
          })
          .where(eq(expenses.id, p.expenseId));
      }

      /* Feedback Cacil 2026-06-12 (audit lanjutan) — UN-BUMP receivedQty PR.
       * Sebelumnya cancel membalik stok + jurnal + expense tapi TIDAK membalik
       * purchase_request_items.receivedQty → item PR terkunci "Dibeli"
       * selamanya dan (sejak bucket 91e2ca1) tidak bisa ditarik ulang.
       * Kurangi sebesar kontribusi pembelian INI saja: received_qty raw per
       * line dikonversi ke satuan master dengan jalur konversi yang SAMA
       * dengan bump (convertPurchaseQty + pack supplier + packConversions +
       * tier belanja/tracking; gagal konversi → fallback raw, mirror bump).
       * Decimal = truth, clamp 0; bigint jaga invariant >0 → ≥1
       * (applyPrReceiveDelta). Lalu recompute status PR. */
      const cancelLinkedItems = await tx
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, v.id));
      const prLinked = cancelLinkedItems.filter((i) => i.purchaseRequestItemId);
      if (prLinked.length > 0) {
        const linkIngIds = Array.from(
          new Set(prLinked.map((i) => i.ingredientId)),
        );
        const linkIngRows = await tx
          .select()
          .from(ingredients)
          .where(inArray(ingredients.id, linkIngIds));
        const linkIngById = new Map(linkIngRows.map((r) => [r.id, r] as const));

        const packMap = new Map<string, PackInfo>();
        if (p.supplierId && linkIngIds.length > 0) {
          const packRows = await tx
            .select({
              ingredientId: supplierIngredients.ingredientId,
              packSize: supplierIngredients.packSize,
              packUnit: supplierIngredients.packUnit,
            })
            .from(supplierIngredients)
            .where(
              and(
                eq(supplierIngredients.outletId, session.user.outletId),
                eq(supplierIngredients.supplierId, p.supplierId),
                inArray(supplierIngredients.ingredientId, linkIngIds),
                isNull(supplierIngredients.deletedAt),
              ),
            );
          for (const r of packRows) {
            const size = parseFloat(r.packSize);
            if (Number.isFinite(size) && size > 0) {
              packMap.set(r.ingredientId, {
                packSize: size,
                packUnit: r.packUnit,
              });
            }
          }
        }

        const prItemIds = prLinked.map((i) => i.purchaseRequestItemId!);
        const prItemRows = await tx
          .select()
          .from(purchaseRequestItems)
          .where(inArray(purchaseRequestItems.id, prItemIds))
          .for("update");
        const prItemMap = new Map(prItemRows.map((r) => [r.id, r] as const));
        const touchedRequestIds = new Set<string>();

        for (const it of prLinked) {
          const prItem = prItemMap.get(it.purchaseRequestItemId!);
          if (!prItem) continue;
          const rawReceived =
            parseFloat(it.receivedQtyDecimal ?? "") || Number(it.receivedQty);
          if (!(rawReceived > 0)) continue; // line ini belum pernah diterima

          const ing = linkIngById.get(it.ingredientId);
          let masterQty = rawReceived; // fallback: anggap sudah satuan master
          if (ing) {
            const existingPacks =
              (ing.packConversions as Array<{
                unitLabel: string;
                qtyPerBase: number;
              }> | null) ?? [];
            const tierPacks: Array<{ unitLabel: string; qtyPerBase: number }> =
              [];
            if (ing.unitBelanja && ing.unitBelanjaPerCogs) {
              const per = parseFloat(ing.unitBelanjaPerCogs);
              if (Number.isFinite(per) && per > 0)
                tierPacks.push({ unitLabel: ing.unitBelanja, qtyPerBase: per });
            }
            if (ing.unitTracking && ing.unitTrackingPerCogs) {
              const per = parseFloat(ing.unitTrackingPerCogs);
              if (Number.isFinite(per) && per > 0)
                tierPacks.push({
                  unitLabel: ing.unitTracking,
                  qtyPerBase: per,
                });
            }
            const conv = convertPurchaseQty({
              qty: rawReceived,
              fromUnit: it.unitOverride ?? it.unitSnapshot ?? ing.unit,
              masterUnit: ing.unit,
              pack: packMap.get(it.ingredientId) ?? null,
              ingredientPacks: mergePackConversions(existingPacks, tierPacks),
            });
            if (conv.ok) masterQty = conv.qtyMaster;
          }

          const currentDecimal = prItem.receivedQtyDecimal
            ? Number(prItem.receivedQtyDecimal)
            : Number(prItem.receivedQty);
          const next = applyPrReceiveDelta({
            currentDecimal,
            delta: -masterQty,
          });
          await tx
            .update(purchaseRequestItems)
            .set({
              receivedQty: next.receivedQty,
              receivedQtyDecimal: next.receivedQtyDecimal,
              updatedAt: new Date(),
            })
            .where(eq(purchaseRequestItems.id, prItem.id));
          prItemMap.set(prItem.id, {
            ...prItem,
            receivedQty: next.receivedQty,
            receivedQtyDecimal: next.receivedQtyDecimal,
          });
          touchedRequestIds.add(prItem.requestId);
        }

        for (const requestId of touchedRequestIds) {
          const allItems = await tx
            .select()
            .from(purchaseRequestItems)
            .where(eq(purchaseRequestItems.requestId, requestId));
          const newStatus = computePrStatus(
            allItems.map((r) => ({
              requestedQty: Number(r.requestedQty),
              receivedQty: Number(r.receivedQty),
              rejectedAt: r.rejectedAt,
            })),
          );
          const [pr] = await tx
            .select()
            .from(purchaseRequests)
            .where(eq(purchaseRequests.id, requestId))
            .limit(1);
          if (pr && pr.status !== "cancelled" && newStatus !== pr.status) {
            await tx
              .update(purchaseRequests)
              .set({
                status: newStatus,
                completedAt: newStatus === "completed" ? new Date() : null,
                updatedAt: new Date(),
              })
              .where(eq(purchaseRequests.id, requestId));
          }
        }
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND")
      return fail("NOT_FOUND", "Pembelian tidak ditemukan");
    if (msg === "BAD_STATE")
      return fail("BAD_STATE", "Pembelian sudah dibatalkan");
    if (msg.startsWith("NEGATIVE_STOCK:")) {
      const name = msg.slice("NEGATIVE_STOCK:".length);
      return fail(
        "VALIDATION_ERROR",
        `Cancel akan bikin stok ${name} negatif. Stok sudah terpakai untuk transaksi/waste.`,
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "purchases.cancel", "Gagal membatalkan pembelian"),
    );
  }

  await logAudit({
    eventType: "purchase.cancel",
    userId: session.user.id,
    entityType: "purchase",
    entityId: v.id,
    payload: { summary: `Cancel purchase — ${v.reason}` },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  // Sesi U — Accounting auto-journal hook (purchase cancel = counter-entry).
  // Source id beda dari purchase_create supaya idempotency hit tidak block.
  {
    const [purchaseRow] = await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, v.id))
      .limit(1);
    if (purchaseRow) {
      /* Sesi AE-177h — section lines + total dari goods_receipt_items (RECEIVED),
       * BUKAN purchase_items (ORDERED). Untuk PO partial-cancel: ordered=300
       * tapi received=200 → cancel harus reverse 200 (= cumulative create
       * jurnal), kalau pakai ordered 300 → phantom -100 di GL. Cancel ordered-only
       * PO (early return TX di atas) → tidak ada GR → sectionLines kosong →
       * SKIP journal hook (tak ada apa-apa yg perlu di-reverse). */
      const items = await db
        .select({
          section: goodsReceiptItems.sectionSnapshot,
          totalCost: goodsReceiptItems.totalCost,
        })
        .from(goodsReceiptItems)
        .innerJoin(
          goodsReceipts,
          eq(goodsReceipts.id, goodsReceiptItems.goodsReceiptId),
        )
        .where(eq(goodsReceipts.purchaseId, v.id));
      const bySection = new Map<string, number>();
      for (const it of items) {
        const key = it.section ?? "null";
        bySection.set(key, (bySection.get(key) ?? 0) + Number(it.totalCost));
      }
      const sectionLines = Array.from(bySection.entries()).map(([key, amount]) => ({
        section: (key === "null" ? null : key) as
          | "kitchen"
          | "bar"
          | "supporting"
          | "cleaning"
          | null,
        amount,
      }));
      const cancelTotal = sectionLines.reduce((s, l) => s + l.amount, 0);
    if (cancelTotal > 0) {
      const todayWib = todayJakartaIso();
      const { fireJournalHook, postJournalForPurchaseCancel } = await import(
        "@/features/accounting/hooks"
      );
      fireJournalHook(
        async () =>
          postJournalForPurchaseCancel({
            outletId: session.user.outletId,
            purchaseId: v.id,
            purchaseLabel: await resolvePurchaseLabel(v.id),
            paymentMethod: purchaseRow.paymentMethod as
              | "cash"
              | "transfer_bca"
              | "transfer_bri"
              | "transfer_other"
              | "top",
            /* Total = jumlah RECEIVED (sectionLines sudah dari gr_items).
             * Untuk PO fully-received: ordered == received, sama saja. */
            total: cancelTotal,
            lines: sectionLines,
            entryDate: todayWib,
            actorId: session.user.id,
          }),
        "purchase_cancel",
      );
    }

      /* Audit AE-181 — purchase yang SUDAH dibayar lalu di-cancel: balik
       * juga jurnal PEMBAYARAN (Dr bank / Cr 2101). Sebelumnya hanya jurnal
       * create yang dibalik → 2101 ketinggalan debit + bank tidak balik.
       * Hook self-skip kalau jurnal purchase_pay tidak pernah ada. */
      if (purchaseRow.paidAt) {
        const { fireJournalHook, postJournalForPurchasePayReversal } =
          await import("@/features/accounting/hooks");
        fireJournalHook(
          async () =>
            postJournalForPurchasePayReversal({
              outletId: session.user.outletId,
              purchaseId: v.id,
              purchaseLabel: await resolvePurchaseLabel(v.id),
              actorId: session.user.id,
            }),
          "purchase_pay_reversal",
        );
      }
    }
  }

  return ok({ id: v.id });
}

// ============================================================================
// Mark TOP purchase as paid — auto-create kas expense
// ============================================================================

export async function markPurchasePaid(
  input: MarkPaidInput,
): Promise<ApiResult<{ id: string; expenseId: string | null }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.mark_paid")) {
    return fail(
      "FORBIDDEN",
      "Hanya manager / owner yang boleh tandai lunas",
    );
  }
  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  /* Sesi AE-188 — tanggal pembayaran dari owner (default hari ini WIB).
   * Dipakai untuk paid_at, tanggal expense kas, DAN entry_date jurnal umum
   * supaya pelunasan mendarat di periode akuntansi yang benar. */
  const todayWib = todayJakartaIso();
  const payDate = v.paymentDate ?? todayWib;
  if (payDate > todayWib) {
    return fail(
      "VALIDATION_ERROR",
      "Tanggal pembayaran tidak boleh di masa depan",
    );
  }
  /* Periode yang sudah dikunci akan menolak jurnal (recordJournal throw
   * PERIOD_LOCKED). Kalau baru ketahuan setelah commit, baris pembayaran
   * sudah tersimpan tapi GL-nya tidak — persis kelas drift yang
   * direkonsiliasi manual di audit AE-181. Jadi dicegat di depan. */
  {
    const [year, month] = payDate.split("-").map(Number);
    const [period] = await db
      .select({ status: accountingPeriods.status })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.outletId, session.user.outletId),
          eq(accountingPeriods.periodYear, year),
          eq(accountingPeriods.periodMonth, month),
        ),
      )
      .limit(1);
    if (period?.status === "locked") {
      return fail(
        "BAD_STATE",
        `Periode ${payDate.slice(0, 7)} sudah dikunci — pilih tanggal pembayaran di periode yang masih terbuka.`,
      );
    }
  }
  /* paidAt disimpan jam 12.00 WIB supaya tanggalnya tetap terbaca sama
   * di zona waktu manapun saat ditampilkan. */
  const paidAtTs = new Date(`${payDate}T12:00:00+07:00`);

  let expenseId: string | null = null;
  /* Audit AE-181 — basis bayar TOP = total GR diterima (bukan totalAmount
   * ordered). Untuk PO partial/under-receive: Cr 2101 terjadi per-GR sebesar
   * yang diterima → debit pelunasan harus simetris, kalau pakai totalAmount
   * full maka 2101 jadi negatif (drift terdeteksi di GL produksi). */
  let paidBase = 0;
  let paidIsTop = false;
  try {
    await db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(purchases)
        .where(
          and(
            eq(purchases.id, v.id),
            eq(purchases.outletId, session.user.outletId),
          ),
        )
        .for("update")
        .limit(1);
      if (!p) throw new Error("NOT_FOUND");
      if (p.status !== "pending_payment") throw new Error("BAD_STATE");

      paidIsTop = p.paymentMethod === "top";
      /* TOP belum terima barang sama sekali → belum ada hutang ter-jurnal,
       * tandai lunas bakal bikin 2101 negatif. Terima barang dulu. */
      if (paidIsTop && p.receiptStatus === "ordered") {
        throw new Error("NOT_RECEIVED");
      }
      /* Sesi AE-188 — hutang tidak bisa dibayar sebelum hutangnya ada.
       * Tanpa penjaga ini, jurnal pelunasan bisa mendarat lebih awal dari
       * jurnal pengakuan hutangnya; Buku Besar dibaca urut tanggal jadi
       * seolah hutangnya belum lunas sampai akhir periode. Persis yang
       * terjadi saat staff memindah tanggal jurnal secara manual (laporan
       * 2026-08-07: bayar 20 Jun untuk hutang yang baru muncul 28 Jun). */
      if (payDate < String(p.purchaseDate)) {
        throw new Error(`BEFORE_DEBT:${String(p.purchaseDate)}`);
      }
      const [grSum] = await tx
        .select({
          total: sql<number>`coalesce(sum(${goodsReceipts.totalAmount}),0)::bigint`,
        })
        .from(goodsReceipts)
        .where(eq(goodsReceipts.purchaseId, v.id));
      const grTotal = Number(grSum?.total ?? 0);
      /* Fallback totalAmount untuk purchase legacy tanpa GR rows. */
      paidBase = grTotal > 0 ? grTotal : Number(p.totalAmount);

      // Auto-create kas expense (best-effort). Audit AE-181: hanya TOP —
      // non-TOP sudah punya expense per-GR (uang keluar saat terima barang),
      // mark-paid non-TOP cuma flip status.
      const [defaultCat] = paidIsTop
        ? await tx
        .select()
        .from(expenseCategories)
        .where(
          and(
            eq(expenseCategories.outletId, session.user.outletId),
            isNull(expenseCategories.deletedAt),
          ),
        )
        .orderBy(asc(expenseCategories.displayOrder))
        .limit(1)
        : [undefined];

      if (defaultCat) {
        const [exp] = await tx
          .insert(expenses)
          .values({
            outletId: session.user.outletId,
            expenseDate: payDate,
            categoryId: defaultCat.id,
            description: `Pelunasan hutang, ${paymentMethodLabel(v.paymentMethod)} — ${buildPurchaseLabel(
              {
                supplierName: await resolveSupplierName(p.supplierId),
                invoiceNo: p.invoiceNo,
                purchaseDate: String(p.purchaseDate),
              },
            )}`,
            amount: paidBase,
            paymentMethod: expensePaymentMethod(v.paymentMethod),
            /* Sesi AE-79 — tag sebagai purchase (lihat catatan sama di
             * createPurchase line ~545). */
            sourceType: "purchase",
            purchaseId: p.id,
            createdBy: session.user.id,
          })
          .returning({ id: expenses.id });
        expenseId = exp.id;
      }

      await tx
        .update(purchases)
        .set({
          status: "paid",
          paidAt: paidAtTs,
          paidBy: session.user.id,
          expenseId,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(purchases.id, v.id));
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND")
      return fail("NOT_FOUND", "Pembelian tidak ditemukan");
    if (msg === "BAD_STATE")
      return fail(
        "BAD_STATE",
        "Pembelian tidak dalam status pending_payment",
      );
    if (msg === "NOT_RECEIVED")
      return fail(
        "NOT_RECEIVED",
        "Belum ada barang diterima — catat penerimaan (GR) dulu sebelum tandai lunas",
      );
    if (msg.startsWith("BEFORE_DEBT:"))
      return fail(
        "VALIDATION_ERROR",
        `Tanggal pembayaran tidak boleh sebelum tanggal pembeliannya (${msg.slice("BEFORE_DEBT:".length)}) — hutangnya belum ada di tanggal itu.`,
      );
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "purchases.markPaid", "Gagal menandai pembelian paid"),
    );
  }

  await logAudit({
    eventType: "purchase.mark_paid",
    userId: session.user.id,
    entityType: "purchase",
    entityId: v.id,
    payload: {
      summary: `Tandai lunas ${payDate} — ${paymentMethodLabel(v.paymentMethod)}`,
      context: { paymentMethod: v.paymentMethod, paymentDate: payDate, expenseId },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  // Sesi U — Accounting auto-journal hook (purchase pay = clear hutang dagang).
  // Source id = purchase.id (uniq per purchase, but distinct sourceType from
  // purchase_create). Expense auto-row TIDAK perlu separate journal — kalau
  // accounting flag ON, expense.create hook akan skip 'manual' check (expense
  // sourceType column belum di-set untuk purchase_pay flow). Jadi safe.
  {
    const [purchaseRow] = await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, v.id))
      .limit(1);
    /* Audit AE-181 — jurnal pelunasan hanya untuk TOP (Dr 2101 / Cr bank);
     * non-TOP tidak punya hutang dagang ter-jurnal. Total = paidBase (GR
     * diterima). Sesi AE-188: tanggal jurnal = tanggal pembayaran pilihan
     * owner, bukan lagi selalu hari ini. */
    if (purchaseRow && paidIsTop) {
      const { fireJournalHook, postJournalForPurchasePay } = await import(
        "@/features/accounting/hooks"
      );
      fireJournalHook(
        async () =>
          postJournalForPurchasePay({
            outletId: session.user.outletId,
            purchaseId: v.id,
            purchaseLabel: await resolvePurchaseLabel(v.id),
            paymentMethod: v.paymentMethod as
              | "cash"
              | "transfer_bca"
              | "transfer_bri"
              | "transfer_other",
            total: paidBase,
            entryDate: payDate,
            actorId: session.user.id,
          }),
        "purchase_pay",
      );
    }
  }

  return ok({ id: v.id, expenseId });
}

/**
 * Koreksi tanggal pembayaran hutang yang SUDAH terlanjur tercatat.
 *
 * Sesi AE-188, permintaan staff: sebelum ada kolom tanggal bayar, pelunasan
 * selalu memakai tanggal saat tombol diklik. Hutang yang dibayar Juli tapi
 * baru sempat diklik Agustus jadi mendarat di jurnal Agustus. Kolom tanggal
 * bayar memperbaiki pencatatan BARU; ini memperbaiki yang terlanjur.
 *
 * Tiga tempat digeser sekaligus supaya tidak ada yang tertinggal:
 *   1. `purchases.paid_at` — tanggal lunas yang tampil di layar Hutang.
 *   2. `expenses.expense_date` — pengeluaran kas pelunasannya.
 *   3. `journal_entries.entry_date` jurnal `purchase_pay` — lewat
 *      `updateJournalEntryDate`, jadi nomor jurnal ikut diterbitkan ulang
 *      kalau pindah bulan dan periode terkunci tetap ditolak.
 *
 * Jurnal digeser DULUAN: kalau periodenya terkunci, langkah itu gagal dan
 * tidak ada satu pun baris yang sempat berubah. Owner-only karena memindahkan
 * jurnal yang sudah diposting (sama dengan `accounting.journal.post`).
 *
 * Hanya untuk pembelian TOP yang berstatus lunas — non-TOP tidak punya
 * peristiwa pelunasan tersendiri (uangnya keluar saat barang diterima).
 */
export async function updatePurchasePaymentDate(input: {
  id: string;
  paymentDate: string;
  reason: string;
}): Promise<
  ApiResult<{
    id: string;
    paymentDate: string;
    previousDate: string;
    journalMoved: boolean;
    expenseMoved: boolean;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.journal.post")) {
    return fail(
      "FORBIDDEN",
      "Hanya owner yang boleh mengoreksi tanggal pembayaran — perubahannya ikut memindahkan jurnal yang sudah diposting.",
    );
  }
  const newDate = input?.paymentDate?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    return fail("VALIDATION_ERROR", "Tanggal harus format YYYY-MM-DD");
  }
  {
    const [y, m, d] = newDate.split("-").map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (
      parsed.getUTCFullYear() !== y ||
      parsed.getUTCMonth() !== m - 1 ||
      parsed.getUTCDate() !== d
    ) {
      return fail("VALIDATION_ERROR", `Tanggal ${newDate} tidak ada di kalender.`);
    }
  }
  if (newDate > todayJakartaIso()) {
    return fail(
      "VALIDATION_ERROR",
      "Tanggal pembayaran tidak boleh di masa depan",
    );
  }
  const reason = input?.reason?.trim() ?? "";
  if (reason.length < 5) {
    return fail("VALIDATION_ERROR", "Alasan koreksi minimal 5 karakter");
  }

  const [p] = await db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.id, input.id),
        eq(purchases.outletId, session.user.outletId),
      ),
    )
    .limit(1);
  if (!p) return fail("NOT_FOUND", "Pembelian tidak ditemukan");
  if (p.status !== "paid") {
    return fail(
      "BAD_STATE",
      "Pembelian ini belum ditandai lunas — tidak ada tanggal pembayaran yang bisa dikoreksi.",
    );
  }
  if (p.paymentMethod !== "top") {
    return fail(
      "BAD_STATE",
      "Hanya pembelian tempo (TOP) yang punya tanggal pelunasan tersendiri. Untuk pembelian tunai, uangnya keluar saat barang diterima — koreksi lewat tanggal penerimaan.",
    );
  }
  /* Sama seperti di markPurchasePaid: pelunasan tidak boleh mendahului
   * hutangnya. Justru koreksi manual yang tidak dijaga inilah yang bikin
   * dua jurnal pelunasan mendarat sebelum hutangnya (laporan 2026-08-07). */
  if (newDate < String(p.purchaseDate)) {
    return fail(
      "VALIDATION_ERROR",
      `Tanggal pembayaran tidak boleh sebelum tanggal pembeliannya (${String(p.purchaseDate)}) — hutangnya belum ada di tanggal itu.`,
    );
  }
  const previousDate = p.paidAt
    ? toJakartaDateOnly(p.paidAt)
    : String(p.purchaseDate);
  if (previousDate === newDate) {
    return fail("NO_CHANGE", "Tanggal barunya sama dengan yang sekarang.");
  }

  /* 1) Jurnal duluan — penjaga paling ketat (periode terkunci / entry sudah
   *    di-reverse). Kalau gagal di sini, tidak ada baris yang terlanjur
   *    berubah. */
  let journalMoved = false;
  {
    const [payEntry] = await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.outletId, session.user.outletId),
          eq(journalEntries.sourceType, "purchase_pay"),
          eq(journalEntries.sourceId, p.id),
          eq(journalEntries.status, "posted"),
        ),
      )
      .limit(1);
    if (payEntry) {
      const { updateJournalEntryDate } = await import(
        "@/features/accounting/actions"
      );
      const moved = await updateJournalEntryDate({
        entryId: payEntry.id,
        newDate,
        reason: `Koreksi tanggal pembayaran hutang — ${reason}`,
      });
      /* Modul accounting memakai bentuk ApiResult sendiri ({ok}, bukan
       * {success}) — jangan disamakan dengan milik modul purchases. */
      if (!moved.ok) {
        return fail(
          moved.error.code === "VALIDATION"
            ? "VALIDATION_ERROR"
            : moved.error.code,
          `Jurnal pelunasan tidak bisa dipindah: ${moved.error.message}`,
        );
      }
      journalMoved = true;
    }
  }

  // 2) Baris pembayaran + pengeluaran kasnya.
  let expenseMoved = false;
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(purchases)
        .set({
          paidAt: new Date(`${newDate}T12:00:00+07:00`),
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(purchases.id, p.id));

      if (p.expenseId) {
        const res = await tx
          .update(expenses)
          .set({
            expenseDate: newDate,
            updatedAt: new Date(),
            updatedBy: session.user.id,
          })
          .where(and(eq(expenses.id, p.expenseId), isNull(expenses.deletedAt)))
          .returning({ id: expenses.id });
        expenseMoved = res.length > 0;
      }
    });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(
        e,
        "purchases.payment_date_update",
        "Gagal memperbarui tanggal pembayaran",
      ),
    );
  }

  await logAudit({
    eventType: "purchase.payment_date_update",
    userId: session.user.id,
    entityType: "purchase",
    entityId: p.id,
    payload: {
      summary: `Koreksi tanggal pembayaran ${previousDate} → ${newDate} — ${reason}`,
      context: { previousDate, newDate, reason, journalMoved, expenseMoved },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return {
    success: true,
    data: {
      id: p.id,
      paymentDate: newDate,
      previousDate,
      journalMoved,
      expenseMoved,
    },
  };
}

/**
 * Sesi AE-199 — koreksi METODE PEMBAYARAN hutang dagang yang sudah lunas.
 *
 * Saudara dari `updatePurchasePaymentDate` (AE-188). Kebutuhannya sama: tagihan
 * sudah ditandai lunas, lalu ketahuan uangnya sebenarnya keluar dari kantong
 * yang lain — misal tercatat Transfer BCA padahal dibayar tunai.
 *
 * Metode menentukan AKUN KAS/BANK mana yang dikredit (1101 tunai, 1110 BCA,
 * 1111 BRI, 1112 lainnya), jadi jurnalnya tidak bisa sekadar ditimpa: entry
 * lama dibalik dengan pola pair-void lalu diposting ulang memakai akun yang
 * benar. Tanpa ini satu-satunya jalan adalah membatalkan pelunasan dan
 * mengulang — yang meninggalkan jejak audit berantakan.
 */
export async function updatePurchasePaymentMethod(input: {
  id: string;
  paymentMethod: PaymentMethod;
  reason: string;
}): Promise<
  ApiResult<{
    id: string;
    paymentMethod: PaymentMethod;
    previousMethod: PaymentMethod | null;
    journalReposted: boolean;
    expenseUpdated: boolean;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.journal.post")) {
    return fail(
      "FORBIDDEN",
      "Hanya owner yang boleh mengoreksi metode pembayaran — perubahannya ikut memindahkan jurnal yang sudah diposting.",
    );
  }

  const parsed = updatePaymentMethodSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const [p] = await db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.id, v.id),
        eq(purchases.outletId, session.user.outletId),
      ),
    )
    .limit(1);
  if (!p) return fail("NOT_FOUND", "Pembelian tidak ditemukan");
  if (p.status !== "paid") {
    return fail(
      "BAD_STATE",
      "Pembelian ini belum ditandai lunas — belum ada pembayaran yang bisa dikoreksi.",
    );
  }
  if (p.paymentMethod !== "top") {
    return fail(
      "BAD_STATE",
      "Hanya pembelian tempo (TOP) yang punya pelunasan tersendiri. Untuk pembelian tunai/transfer, uangnya keluar saat barang diterima — koreksi lewat Edit Pembelian.",
    );
  }

  /* Metode pelunasan yang berlaku sekarang tidak disimpan di baris purchase
   * (kolom paymentMethod tetap 'top' = jenis pembeliannya). Sumber
   * kebenarannya adalah baris kas pelunasan yang dibuat markPurchasePaid. */
  const [payExpense] = p.expenseId
    ? await db
        .select({
          id: expenses.id,
          paymentMethod: expenses.paymentMethod,
        })
        .from(expenses)
        .where(and(eq(expenses.id, p.expenseId), isNull(expenses.deletedAt)))
        .limit(1)
    : [];

  const payDate = p.paidAt
    ? toJakartaDateOnly(p.paidAt)
    : String(p.purchaseDate);

  /* 1) Jurnal dulu — penjaga paling ketat (periode terkunci). Kalau gagal di
   *    sini, belum ada baris lain yang terlanjur berubah. */
  let journalReposted = false;
  const [payEntry] = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, session.user.outletId),
        eq(journalEntries.sourceType, "purchase_pay"),
        eq(journalEntries.sourceId, p.id),
        eq(journalEntries.status, "posted"),
      ),
    )
    .limit(1);

  if (payEntry) {
    /* Nilai jurnal ulang WAJIB persis sama dengan yang dibalik, jadi diambil
     * dari entry-nya sendiri — bukan dihitung ulang dari totalAmount.
     * markPurchasePaid memakai total GR kalau ada (bisa beda dari nilai PO
     * saat penerimaan kurang/lebih); menghitung ulang di sini akan membuat
     * pembalik dan posting ulang tidak seimbang, dan 2101 ikut melenceng. */
    const [postedTotal] = await db
      .select({
        total: sql<number>`coalesce(sum(${journalLines.debit}), 0)::bigint`,
      })
      .from(journalLines)
      .where(eq(journalLines.entryId, payEntry.id));
    const repostTotal = Number(postedTotal?.total ?? 0);
    if (repostTotal <= 0) {
      return fail(
        "JOURNAL_ERROR",
        "Jurnal pelunasan lama tidak punya nilai yang bisa diposting ulang.",
      );
    }
    const [{ pairVoidJournalForSource }, { postJournalForPurchasePay }] =
      await Promise.all([
        import("@/features/accounting/journal-void"),
        import("@/features/accounting/hooks"),
      ]);
    const label = await resolvePurchaseLabel(p.id);
    try {
      await pairVoidJournalForSource({
        outletId: session.user.outletId,
        sourceType: "purchase_pay",
        voidSourceType: "purchase_pay_reversal",
        sourceId: p.id,
        actorId: session.user.id,
        reason: `Koreksi metode pembayaran — ${v.reason}`,
      });
      await postJournalForPurchasePay({
        outletId: session.user.outletId,
        purchaseId: p.id,
        purchaseLabel: label,
        paymentMethod: v.paymentMethod,
        total: repostTotal,
        entryDate: payDate,
        actorId: session.user.id,
      });
      journalReposted = true;
    } catch (e) {
      return fail(
        "JOURNAL_ERROR",
        logAndSanitize(
          e,
          "purchases.payment_method_update.journal",
          "Jurnal pelunasan tidak bisa diposting ulang",
        ),
      );
    }
  }

  // 2) Baris kas pelunasannya.
  let expenseUpdated = false;
  if (payExpense) {
    try {
      const res = await db
        .update(expenses)
        .set({
          paymentMethod: expensePaymentMethod(v.paymentMethod),
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(expenses.id, payExpense.id))
        .returning({ id: expenses.id });
      expenseUpdated = res.length > 0;
    } catch (e) {
      return fail(
        "DB_ERROR",
        logAndSanitize(
          e,
          "purchases.payment_method_update",
          "Gagal memperbarui baris kas pelunasan",
        ),
      );
    }
  }

  await logAudit({
    eventType: "purchase.payment_method_update",
    userId: session.user.id,
    entityType: "purchase",
    entityId: p.id,
    payload: {
      summary: `Koreksi metode pembayaran hutang → ${labelMetodeBayar(v.paymentMethod)} — ${v.reason}`,
      context: {
        previousExpenseMethod: payExpense?.paymentMethod ?? null,
        newMethod: v.paymentMethod,
        reason: v.reason,
        journalReposted,
        expenseUpdated,
        payDate,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({
    id: p.id,
    paymentMethod: v.paymentMethod,
    previousMethod: null,
    journalReposted,
    expenseUpdated,
  });
}

/* Sesi AE-87 — sebelumnya ada `export type { Purchase }` di sini, tapi
 * Turbopack dev-mode 'use server' file punya bug: type-only re-export
 * trigger runtime ReferenceError "Purchase is not defined" saat module
 * evaluated → semua server action di file ini broken. Type re-export
 * dihapus karena Purchase sudah di-export dari src/features/purchases/
 * index.ts. Consumer import dari `@/features/purchases` (idiomatic). */

// Untyped re-export for fetchPurchaseById helper (used internally).
export async function getPurchaseRaw(
  id: string,
): Promise<ApiResult<Purchase | null>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat pembelian");
  }
  return ok(await fetchPurchaseById(id, session.user.outletId));
}

/* ============================================================================
 * Sesi AE-173 — Alur PR → PO → GR.
 *
 * createPurchase (di atas) TIDAK diubah = jalur "Langsung Terima" (instant),
 * default receiptStatus='received'. Dua fungsi di bawah menambah tahap:
 *   createPurchaseOrder  → buat PO (ordered): catat pesanan, NOL efek.
 *   confirmGoodsReceipt  → GR: barulah expense + (stok kalau perpetual) + PR
 *                          bump + jurnal terjadi (mirror createPurchase).
 * ========================================================================== */

/** Buat Purchase Order (tahap 'ordered'). Tanpa efek stok/expense/jurnal. */
export async function createPurchaseOrder(
  input: CreatePurchaseInput,
): Promise<ApiResult<{ id: string; totalAmount: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.create")) {
    return fail("FORBIDDEN", "Tidak punya hak buat pembelian");
  }
  const parsed = createPurchaseSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;
  const isTop = v.paymentMethod === "top";
  const dueDate = isTop ? addDaysIso(v.purchaseDate, v.paymentTermDays) : null;

  let resultId = "";
  let totalAmount = 0;
  try {
    const result = await db.transaction(async (tx) => {
      const ingIds = v.items.map((i) => i.ingredientId);
      const ingRows = await tx
        .select()
        .from(ingredients)
        .where(
          and(inArray(ingredients.id, ingIds), isNull(ingredients.deletedAt)),
        );
      const ingById = new Map(ingRows.map((r) => [r.id, r] as const));
      for (const item of v.items) {
        const row = ingById.get(item.ingredientId);
        if (!row) throw new Error("INGREDIENT_NOT_FOUND");
        if (row.outletId !== session.user.outletId) {
          throw new Error("OUTLET_MISMATCH");
        }
      }

      /* Feedback Cacil 2026-06-12 (audit lanjutan) — validasi PR item utk PO.
       * Sebelumnya createPurchaseOrder TIDAK validasi link PR sama sekali
       * (exists/outlet/cancelled/rejected lolos semua) + tanpa guard
       * anti dobel-tarik. Mirror blok validasi createPurchase: lock FOR
       * UPDATE → dua tarik bersamaan serial, yang kedua kena guard. */
      const poPrItemIds = v.items
        .map((i) => i.purchaseRequestItemId)
        .filter((id): id is string => Boolean(id));
      if (poPrItemIds.length > 0) {
        const prItemRows = await tx
          .select()
          .from(purchaseRequestItems)
          .where(inArray(purchaseRequestItems.id, poPrItemIds))
          .for("update");
        const prItemMap = new Map(prItemRows.map((r) => [r.id, r] as const));
        const prIds = Array.from(new Set(prItemRows.map((r) => r.requestId)));
        const prRows =
          prIds.length > 0
            ? await tx
                .select()
                .from(purchaseRequests)
                .where(inArray(purchaseRequests.id, prIds))
            : [];
        const prHeaderMap = new Map(prRows.map((r) => [r.id, r] as const));
        const linkedRows = await tx
          .select({ prItemId: purchaseItems.purchaseRequestItemId })
          .from(purchaseItems)
          .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
          .where(
            and(
              inArray(purchaseItems.purchaseRequestItemId, poPrItemIds),
              ne(purchases.status, "cancelled"),
            ),
          );
        const alreadyLinked = new Set(
          linkedRows.map((r) => r.prItemId).filter(Boolean),
        );
        for (const item of v.items) {
          if (!item.purchaseRequestItemId) continue;
          const ingName = ingById.get(item.ingredientId)?.name ?? "Bahan";
          const prItem = prItemMap.get(item.purchaseRequestItemId);
          if (!prItem) throw new Error("PR_ITEM_NOT_FOUND");
          const pr = prHeaderMap.get(prItem.requestId);
          if (!pr) throw new Error("PR_NOT_FOUND");
          if (pr.outletId !== session.user.outletId) {
            throw new Error("OUTLET_MISMATCH");
          }
          if (pr.status === "cancelled") {
            throw new Error(`PR_CANCELLED:${ingName}`);
          }
          if (prItem.rejectedAt) {
            throw new Error(`PR_ITEM_REJECTED:${ingName}`);
          }
          if (Number(prItem.receivedQty) > 0) {
            throw new Error(`PR_ITEM_ALREADY_BOUGHT:${ingName}`);
          }
          if (alreadyLinked.has(item.purchaseRequestItemId)) {
            throw new Error(`PR_ITEM_ALREADY_LINKED:${ingName}`);
          }
        }
      }

      /* Sesi AE-216 — sama dengan createPurchase: uang PO diambil dari
       * Total Bayar tiap baris, dengan rem kewajaran lebih dulu. */
      for (const item of v.items) {
        if (!isLineTotalConsistent(item)) {
          const ing = ingById.get(item.ingredientId);
          throw new Error(`LINE_TOTAL_MISMATCH:${ing?.name ?? "bahan"}`);
        }
      }
      let total = 0;
      for (const item of v.items) total += resolveLineTotal(item);

      const urlsRaw = v.receiptImageUrls ?? null;
      const legacyUrl = v.receiptImageUrl ?? null;
      const receiptImageUrls =
        urlsRaw && urlsRaw.length > 0 ? urlsRaw : legacyUrl ? [legacyUrl] : null;
      const receiptImageUrl =
        receiptImageUrls && receiptImageUrls.length > 0
          ? receiptImageUrls[0]
          : null;

      const [created] = await tx
        .insert(purchases)
        .values({
          outletId: session.user.outletId,
          supplierId: v.supplierId,
          /* Sesi AE-177 — persist link PR sumber. */
          fromPurchaseRequestId: v.fromPurchaseRequestId ?? null,
          purchaseDate: v.purchaseDate,
          paymentMethod: v.paymentMethod,
          paymentTermDays: v.paymentTermDays,
          dueDate,
          invoiceNo: v.invoiceNo ?? null,
          notes: v.notes ?? null,
          receiptImageUrl,
          receiptImageUrls,
          // PO belum dibayar & belum diterima sampai GR.
          status: "pending_payment",
          receiptStatus: "ordered",
          totalAmount: total,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        })
        .returning();
      if (!created) throw new Error("INSERT_FAILED");

      for (const item of v.items) {
        const ing = ingById.get(item.ingredientId)!;
        await tx.insert(purchaseItems).values({
          purchaseId: created.id,
          ingredientId: item.ingredientId,
          qty: Math.max(1, Math.round(item.qty)),
          qtyDecimal: item.qty.toFixed(4),
          unitCost: item.unitCost,
          /* Sesi AE-216 — Total Bayar dari nota, bukan hasil kali ulang. */
          totalCost: resolveLineTotal(item),
          movementId: null,
          ingredientNameSnapshot: ing.name,
          unitSnapshot: ing.unit,
          unitOverride: item.unit?.trim() || null,
          sectionSnapshot: ing.section,
          purchaseRequestItemId: item.purchaseRequestItemId ?? null,
        });
      }
      return { created, total };
    });
    resultId = result.created.id;
    totalAmount = result.total;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "INGREDIENT_NOT_FOUND")
      return fail("NOT_FOUND", "Salah satu bahan tidak ditemukan / non-aktif");
    if (msg === "OUTLET_MISMATCH")
      return fail("FORBIDDEN", "Bahan dari outlet lain — kontak admin");
    /* Sesi AE-216 — Total Bayar tidak berpasangan dengan qty × harga. */
    if (msg.startsWith("LINE_TOTAL_MISMATCH:")) {
      const ingName = msg.slice("LINE_TOTAL_MISMATCH:".length);
      return fail(
        "VALIDATION_ERROR",
        `Bahan "${ingName}": Total Bayar tidak cocok dengan QTY × harga satuan. Cek lagi angkanya.`,
      );
    }
    /* Feedback Cacil 2026-06-12 — validasi PR + anti dobel-tarik di PO. */
    if (msg === "PR_ITEM_NOT_FOUND")
      return fail("NOT_FOUND", "Item Permintaan Belanja tidak ditemukan");
    if (msg === "PR_NOT_FOUND")
      return fail("NOT_FOUND", "Permintaan Belanja tidak ditemukan");
    if (msg.startsWith("PR_CANCELLED:")) {
      const ingName = msg.slice("PR_CANCELLED:".length);
      return fail(
        "CONFLICT",
        `Bahan "${ingName}": Permintaan Belanja-nya sudah dibatalkan`,
      );
    }
    if (msg.startsWith("PR_ITEM_REJECTED:")) {
      const ingName = msg.slice("PR_ITEM_REJECTED:".length);
      return fail(
        "CONFLICT",
        `Bahan "${ingName}": item PR sudah ditolak, tidak bisa di-belikan`,
      );
    }
    if (msg.startsWith("PR_ITEM_ALREADY_BOUGHT:")) {
      const ingName = msg.slice("PR_ITEM_ALREADY_BOUGHT:".length);
      return fail(
        "CONFLICT",
        `Bahan "${ingName}": item PR ini sudah pernah dibeli. Refresh halaman — kalau memang mau beli lagi, pakai Catat Pembelian biasa (tanpa tarik PR).`,
      );
    }
    if (msg.startsWith("PR_ITEM_ALREADY_LINKED:")) {
      const ingName = msg.slice("PR_ITEM_ALREADY_LINKED:".length);
      return fail(
        "CONFLICT",
        `Bahan "${ingName}": item PR ini sudah ditarik ke PO aktif (menunggu diterima). Refresh halaman untuk lihat status terbaru.`,
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "purchases.order_create", "Gagal menyimpan PO"),
    );
  }

  await logAudit({
    eventType: "purchase.order_create",
    userId: session.user.id,
    entityType: "purchase",
    entityId: resultId,
    payload: {
      summary: `PO ${paymentMethodLabel(v.paymentMethod)} ${v.purchaseDate} (${v.items.length} item, total ${totalAmount})`,
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({ id: resultId, totalAmount });
}

// ============================================================================
// Edit PO (Sesi AE-188)
// ============================================================================

/**
 * Konteks untuk layar Edit PO: detail + apakah boleh diedit dan sejauh mana.
 *
 * Dipisah dari `getPurchase` karena UI perlu tahu jumlah GR — itu yang
 * menentukan apakah edit masih bebas (belum ada barang masuk) atau tinggal
 * harga saja. Aturan di sini WAJIB cerminan `updatePurchaseOrder`; server
 * tetap yang menegakkan, ini supaya form tidak menawarkan yang mustahil.
 */
export async function getPurchaseEditContext(id: string): Promise<
  ApiResult<{
    detail: PurchaseDetail;
    goodsReceiptCount: number;
    editable: boolean;
    priceOnly: boolean;
    blockedReason: string | null;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.update")) {
    return fail("FORBIDDEN", "Hanya manager / owner yang boleh edit PO");
  }
  const detail = await fetchPurchaseDetail(id, session.user.outletId);
  if (!detail) return fail("NOT_FOUND", "Pembelian tidak ditemukan");

  const [grCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(goodsReceipts)
    .where(eq(goodsReceipts.purchaseId, id));
  const goodsReceiptCount = Number(grCount?.n ?? 0);
  const priceOnly = goodsReceiptCount > 0;

  let blockedReason: string | null = null;
  if (detail.status === "cancelled") {
    blockedReason = "PO ini sudah dibatalkan.";
  } else if (detail.paymentMethod === "top" && detail.status === "paid") {
    blockedReason =
      "Hutang TOP ini sudah ditandai lunas — nilainya sudah dipakai jurnal pelunasan.";
  } else if (!priceOnly && detail.receiptStatus !== "ordered") {
    blockedReason =
      "Ini pembelian langsung (bukan lewat alur PO → Terima Barang). Kalau ada yang salah, batalkan lalu catat ulang.";
  }

  return ok({
    detail,
    goodsReceiptCount,
    editable: blockedReason === null,
    priceOnly,
    blockedReason,
  });
}

/**
 * Ubah PO yang sudah tersimpan.
 *
 * Latar belakang (owner, sesi AE-188): PIC Operasional sering harus memproses
 * penerimaan barang (GR) SEBELUM nota/harga final diterima. Solusinya PO
 * dibuat dengan harga Rp 0 dulu, lalu harga asli diisi di sini begitu nota
 * datang. Karena itu edit harus ikut merapikan SEMUA turunan PO, bukan cuma
 * angka di layar PO.
 *
 * Dua mode, dipilih otomatis dari kondisi PO:
 *
 *  1. **Belum ada GR** (`receiptStatus='ordered'`) — edit bebas: baris boleh
 *     ditambah/dihapus, qty & satuan & supplier & metode bayar boleh berubah.
 *     Tidak ada efek turunan sama sekali (stok, kas, dan jurnal memang baru
 *     lahir saat GR).
 *
 *  2. **Sudah ada GR** (`partial` / `received`) — hanya HARGA yang boleh
 *     berubah (plus nomor invoice, catatan, nota, tanggal & tempo). Qty,
 *     satuan, daftar bahan, supplier, dan metode bayar dikunci karena sudah
 *     terlanjur jadi movement stok + baris GR. Yang ikut disinkronkan:
 *       - `purchase_items` + `purchases.total_amount`
 *       - `goods_receipt_items` + `goods_receipts.total_amount`
 *       - expense kas per GR (dibuat kalau tadinya Rp 0, di-soft-delete
 *         kalau harga dikoreksi jadi 0 — kolom amount punya CHECK > 0)
 *       - `inventory_movements.unit_cost_at_movement`
 *       - HPP rata-rata bahan, HANYA untuk movement yang memang menambah
 *         stok (mode perpetual); mode periodic tidak menyentuh stok sama
 *         sekali sehingga tidak ada yang perlu dikoreksi
 *       - jurnal GR (dibalik lalu diposting ulang) — lihat
 *         `resyncJournalForGoodsReceipt`
 *
 * Ditolak: PO yang sudah dibatalkan, hutang TOP yang sudah ditandai lunas
 * (nilainya sudah dipakai jurnal pelunasan), dan pembelian instan lama
 * (`createPurchase`, tanpa baris GR) yang efeknya melekat ke purchaseId —
 * itu harus dibatalkan lalu dicatat ulang.
 */
export async function updatePurchaseOrder(
  input: UpdatePurchaseOrderInput,
): Promise<ApiResult<UpdatePurchaseOrderResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.update")) {
    return fail("FORBIDDEN", "Hanya manager / owner yang boleh edit PO");
  }
  const parsed = updatePurchaseOrderSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  /* Payload jurnal dikumpulkan di dalam transaksi, di-fire setelah commit
   * (pola sama dengan receiveGoods — hook tidak boleh ikut transaksi). */
  const journalJobs: Array<{
    goodsReceiptId: string;
    paymentMethod: PaymentMethod;
    total: number;
    entryDate: string;
    lines: Array<{
      section: "kitchen" | "bar" | "supporting" | "cleaning" | null;
      amount: number;
    }>;
  }> = [];
  let newTotalAmount = 0;
  let priceOnly = false;
  let receiptsResynced = 0;
  let expensesTouched = 0;
  let oldTotalAmount = 0;

  try {
    await db.transaction(async (tx) => {
      const [po] = await tx
        .select()
        .from(purchases)
        .where(
          and(
            eq(purchases.id, v.id),
            eq(purchases.outletId, session.user.outletId),
          ),
        )
        .for("update")
        .limit(1);
      if (!po) throw new Error("NOT_FOUND");
      if (po.status === "cancelled") throw new Error("CANCELLED");
      if (po.paymentMethod === "top" && po.status === "paid") {
        throw new Error("ALREADY_SETTLED");
      }
      oldTotalAmount = Number(po.totalAmount);

      const grRows = await tx
        .select()
        .from(goodsReceipts)
        .where(eq(goodsReceipts.purchaseId, po.id))
        .orderBy(asc(goodsReceipts.receivedDate));
      priceOnly = grRows.length > 0;
      /* Pembelian instan lama (createPurchase): receiptStatus sudah
       * 'received' tapi tidak punya baris GR — movement/expense/jurnalnya
       * melekat ke purchaseId, bukan ke GR. Jalur resync di bawah tidak
       * berlaku, jadi lebih jujur ditolak daripada bikin GL melenceng. */
      if (!priceOnly && po.receiptStatus !== "ordered") {
        throw new Error("LEGACY_INSTANT");
      }

      /* Jurnal GR diposting ulang dengan entry_date = tanggal terima. Kalau
       * periode bulan itu sudah dikunci, recordJournal akan throw — tapi itu
       * terjadi SETELAH commit (hook fire-and-forget), sehingga nilai GR,
       * kas, dan HPP sudah berubah sementara GL tetap memegang angka lama.
       * Persis kelas drift yang direkonsiliasi manual di audit AE-181, jadi
       * dicegat di depan seperti di markPurchasePaid. */
      if (priceOnly) {
        const months = Array.from(
          new Set(grRows.map((gr) => String(gr.receivedDate).slice(0, 7))),
        );
        for (const ym of months) {
          const [year, month] = ym.split("-").map(Number);
          const [period] = await tx
            .select({ status: accountingPeriods.status })
            .from(accountingPeriods)
            .where(
              and(
                eq(accountingPeriods.outletId, session.user.outletId),
                eq(accountingPeriods.periodYear, year),
                eq(accountingPeriods.periodMonth, month),
              ),
            )
            .limit(1);
          if (period?.status === "locked") {
            throw new Error(`PERIOD_LOCKED:${ym}`);
          }
        }
      }

      const existingItems = await tx
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, po.id));
      const existingById = new Map(existingItems.map((r) => [r.id, r] as const));

      const ingIds = Array.from(
        new Set(v.items.map((i) => i.ingredientId)),
      );
      /* Bahan yang sudah di-soft-delete tetap boleh dibaca di mode
       * harga-saja: barisnya sudah terlanjur ada di PO dan terkunci ke bahan
       * yang sama, jadi menolaknya cuma memblokir koreksi harga PO lama.
       * Untuk edit bebas (baris masih bisa diganti) bahan mati tetap ditolak,
       * sama seperti createPurchaseOrder. */
      const ingRows = await tx
        .select()
        .from(ingredients)
        .where(inArray(ingredients.id, ingIds));
      const ingById = new Map(ingRows.map((r) => [r.id, r] as const));
      for (const item of v.items) {
        const row = ingById.get(item.ingredientId);
        if (!row) throw new Error("INGREDIENT_NOT_FOUND");
        if (row.outletId !== session.user.outletId) {
          throw new Error("OUTLET_MISMATCH");
        }
        if (!priceOnly && row.deletedAt) {
          throw new Error("INGREDIENT_NOT_FOUND");
        }
      }

      /* ---- PO yang sudah diterima: perubahan DIRAMBATKAN, bukan dikunci ----
       *
       * Sesi AE-200 — dulu blok ini menolak semua perubahan selain harga.
       * Akibatnya kemampuan mengubah item/qty/supplier tidak pernah bisa
       * dipakai: di produksi SEMUA pembelian sudah punya penerimaan (alur di
       * outlet ini "terima dulu, nota menyusul"). Sekarang perubahannya
       * dirambatkan ke baris penerimaan + pergerakan stok (lihat planGrMirror).
       *
       * Dua hal tetap ditolak keras, karena aturan "penerimaan mengikuti PO"
       * jadi ambigu atau tidak aman di sana: */
      if (priceOnly) {
        /* (a) Penerimaan bertahap — tidak jelas penerimaan mana yang harus
         *     menyesuaikan qty barunya. Di produksi tidak pernah terjadi
         *     (233 dari 233 pembelian punya tepat satu penerimaan), jadi
         *     menolak lebih benar daripada menebak. */
        if (grRows.length > 1) {
          throw new Error("MULTI_GR");
        }
      }

      /* ---- Validasi link PR untuk baris yang BARU ditautkan ----
       *
       * "Baru" mencakup dua hal: tautan yang memang berubah, DAN baris yang
       * bahannya diganti tapi tautan PR-nya dibiarkan. Kasus kedua tidak
       * kelihatan sebagai perubahan tautan, padahal artinya item PR "Gula"
       * kini menempel di baris "Kopi" — saat GR, receivedQty PR yang salah
       * yang di-bump dan PR ikut ter-tandai selesai. */
      const newlyLinked = v.items.filter((i) => {
        if (!i.purchaseRequestItemId) return false;
        const prev = i.id ? existingById.get(i.id) : undefined;
        if (!prev) return true;
        return (
          prev.purchaseRequestItemId !== i.purchaseRequestItemId ||
          prev.ingredientId !== i.ingredientId
        );
      });
      if (newlyLinked.length > 0) {
        const linkIds = newlyLinked.map((i) => i.purchaseRequestItemId!);
        const prItemRows = await tx
          .select()
          .from(purchaseRequestItems)
          .where(inArray(purchaseRequestItems.id, linkIds))
          .for("update");
        const prItemMap = new Map(prItemRows.map((r) => [r.id, r] as const));
        const prIds = Array.from(new Set(prItemRows.map((r) => r.requestId)));
        const prRows =
          prIds.length > 0
            ? await tx
                .select()
                .from(purchaseRequests)
                .where(inArray(purchaseRequests.id, prIds))
            : [];
        const prHeaderMap = new Map(prRows.map((r) => [r.id, r] as const));
        /* Baris milik PO ini sendiri tidak dihitung sebagai "sudah ditarik". */
        const linkedRows = await tx
          .select({ prItemId: purchaseItems.purchaseRequestItemId })
          .from(purchaseItems)
          .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
          .where(
            and(
              inArray(purchaseItems.purchaseRequestItemId, linkIds),
              ne(purchases.status, "cancelled"),
              ne(purchases.id, po.id),
            ),
          );
        const alreadyLinked = new Set(
          linkedRows.map((r) => r.prItemId).filter(Boolean),
        );
        for (const item of newlyLinked) {
          const ingName = ingById.get(item.ingredientId)?.name ?? "Bahan";
          const prItem = prItemMap.get(item.purchaseRequestItemId!);
          if (!prItem) throw new Error("PR_ITEM_NOT_FOUND");
          const pr = prHeaderMap.get(prItem.requestId);
          if (!pr) throw new Error("PR_NOT_FOUND");
          if (pr.outletId !== session.user.outletId) {
            throw new Error("OUTLET_MISMATCH");
          }
          if (pr.status === "cancelled") throw new Error(`PR_CANCELLED:${ingName}`);
          if (prItem.rejectedAt) throw new Error(`PR_ITEM_REJECTED:${ingName}`);
          if (Number(prItem.receivedQty) > 0) {
            throw new Error(`PR_ITEM_ALREADY_BOUGHT:${ingName}`);
          }
          if (alreadyLinked.has(item.purchaseRequestItemId!)) {
            throw new Error(`PR_ITEM_ALREADY_LINKED:${ingName}`);
          }
          /* Tautan hanya sah kalau bahannya memang sama. Tanpa ini, ganti
           * bahan sambil membiarkan tautan lama bikin PR bahan lain yang
           * ter-bump saat barang diterima. */
          if (
            prItem.ingredientId &&
            prItem.ingredientId !== item.ingredientId
          ) {
            throw new Error(`PR_ITEM_MISMATCH:${ingName}`);
          }
        }
      }

      // ---- Tulis baris item ----
      const keptIds = new Set(
        v.items.map((i) => i.id).filter((id): id is string => Boolean(id)),
      );
      const removed = existingItems.filter((r) => !keptIds.has(r.id));
      if (removed.length > 0) {
        const removedIds = removed.map((r) => r.id);

        /* Sesi AE-200b — baris penerimaan yang menunjuk baris PO ini WAJIB
         * dihapus DULU. `goods_receipt_items.purchase_item_id` punya foreign
         * key tanpa cascade, jadi menghapus baris PO lebih dulu langsung
         * ditolak database — dan pesannya jatuh ke "Gagal menyimpan perubahan
         * PO" yang generik. Dulu blok ini aman karena penghapusan hanya
         * mungkin di PO yang belum diterima; sejak AE-200 asumsi itu batal. */
        const orphanGrItems = await tx
          .select({
            id: goodsReceiptItems.id,
            movementId: goodsReceiptItems.movementId,
          })
          .from(goodsReceiptItems)
          .where(inArray(goodsReceiptItems.purchaseItemId, removedIds));

        if (orphanGrItems.length > 0) {
          const orphanMovementIds = orphanGrItems
            .map((g) => g.movementId)
            .filter((x): x is string => Boolean(x));

          /* Pergerakan yang BENAR-BENAR menambah stok tidak boleh dibuang
           * begitu saja — nilai persediaan & HPP sudah memakainya. Tolak,
           * sama seperti perubahan qty di pembelian era perpetual. */
          if (orphanMovementIds.length > 0) {
            const [stillCounted] = await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(inventoryMovements)
              .where(
                and(
                  inArray(inventoryMovements.id, orphanMovementIds),
                  eq(inventoryMovements.skippedStockUpdate, false),
                ),
              );
            if (Number(stillCounted?.n ?? 0) > 0) {
              throw new Error("LEGACY_STOCK_LOCKED");
            }
          }

          /* URUTAN HAPUS WAJIB: baris penerimaan → baris PO → pergerakan.
           * Dua foreign key menunjuk ke pergerakan yang sama —
           * `goods_receipt_items.movement_id` DAN `purchase_items.movement_id`
           * — jadi pergerakan harus jadi yang TERAKHIR. Diuji langsung ke
           * database: menghapus pergerakan sebelum baris PO ditolak dengan
           * `purchase_items_movement_id_...` (23503). */
          await tx.delete(goodsReceiptItems).where(
            inArray(
              goodsReceiptItems.id,
              orphanGrItems.map((g) => g.id),
            ),
          );

          await tx
            .delete(purchaseItems)
            .where(inArray(purchaseItems.id, removedIds));

          if (orphanMovementIds.length > 0) {
            await tx
              .delete(inventoryMovements)
              .where(inArray(inventoryMovements.id, orphanMovementIds));
          }
        } else {
          await tx
            .delete(purchaseItems)
            .where(inArray(purchaseItems.id, removedIds));
        }
      }

      /* purchase_items.id final per baris input — dipakai penyelarasan GR. */
      const finalItemIds = new Map<(typeof v.items)[number], string>();
      let total = 0;
      for (const item of v.items) {
        const lineTotal = Math.round(item.qty * item.unitCost);
        total += lineTotal;
        const ing = ingById.get(item.ingredientId)!;
        if (item.id && existingById.has(item.id)) {
          const prev = existingById.get(item.id)!;
          /* Snapshot (nama / satuan master / section) hanya di-refresh kalau
           * bahannya memang diganti. Section snapshot menentukan akun
           * Persediaan mana yang di-debit saat GR — kalau ikut bahan lama,
           * jurnalnya mendarat di akun yang salah. Untuk baris yang bahannya
           * tetap, snapshot lama sengaja dibiarkan: itu memang potret saat PO
           * dibuat. */
          const ingredientChanged = prev.ingredientId !== item.ingredientId;
          await tx
            .update(purchaseItems)
            .set({
              ingredientId: item.ingredientId,
              qty: Math.max(1, Math.round(item.qty)),
              qtyDecimal: item.qty.toFixed(4),
              unitCost: item.unitCost,
              totalCost: lineTotal,
              unitOverride: item.unit?.trim() || null,
              purchaseRequestItemId: item.purchaseRequestItemId ?? null,
              ...(ingredientChanged
                ? {
                    ingredientNameSnapshot: ing.name,
                    unitSnapshot: ing.unit,
                    sectionSnapshot: ing.section,
                  }
                : {}),
            })
            .where(eq(purchaseItems.id, item.id));
        } else {
          const [insertedItem] = await tx
            .insert(purchaseItems)
            .values({
              purchaseId: po.id,
              ingredientId: item.ingredientId,
              qty: Math.max(1, Math.round(item.qty)),
              qtyDecimal: item.qty.toFixed(4),
              unitCost: item.unitCost,
              totalCost: lineTotal,
              movementId: null,
              ingredientNameSnapshot: ing.name,
              unitSnapshot: ing.unit,
              unitOverride: item.unit?.trim() || null,
              sectionSnapshot: ing.section,
              purchaseRequestItemId: item.purchaseRequestItemId ?? null,
            })
            .returning({ id: purchaseItems.id });
          /* Sesi AE-200 — id baris baru dibutuhkan untuk menautkan baris
           * penerimaannya. Tanpa ini baris baru tidak pernah punya GR dan
           * nilainya hilang dari jurnal penerimaan. */
          finalItemIds.set(item, insertedItem.id);
        }
        if (item.id && existingById.has(item.id)) {
          finalItemIds.set(item, item.id);
        }
      }
      newTotalAmount = total;

      /* ---- Selaraskan DAFTAR & QTY baris penerimaan dengan PO (AE-200) ----
       *
       * Sengaja dipisah dari penyesuaian NILAI di bawahnya: langkah ini hanya
       * membetulkan baris mana yang ada dan berapa qty-nya, lalu blok lama —
       * yang sudah teruji untuk koreksi harga — yang menghitung ulang nilai,
       * total GR, pengeluaran kas, HPP rata-rata, dan jurnalnya. Dengan begitu
       * jalur harga yang sudah jalan tidak ikut dibongkar.
       *
       * `totalCost` DIBIARKAN pada nilai lama di sini; blok bawah membacanya
       * sebagai "nilai sebelum" untuk menghitung selisih HPP. Kalau ditulis di
       * sini juga, selisihnya terhitung dua kali. */
      if (priceOnly && grRows.length === 1) {
        const gr = grRows[0];
        const grItemsNow = await tx
          .select()
          .from(goodsReceiptItems)
          .where(eq(goodsReceiptItems.goodsReceiptId, gr.id));

        const movementIds = grItemsNow
          .map((g) => g.movementId)
          .filter((x): x is string => Boolean(x));
        const movementRows =
          movementIds.length > 0
            ? await tx
                .select()
                .from(inventoryMovements)
                .where(inArray(inventoryMovements.id, movementIds))
                .for("update")
            : [];
        const movementById = new Map(movementRows.map((m) => [m.id, m] as const));

        /* Qty satuan-dasar per baris.
         *
         * Untuk baris yang SUDAH punya penerimaan, faktor konversinya dibaca
         * BALIK dari data tersimpan (qty pergerakan ÷ qty nota lama) — bukan
         * dihitung ulang. Ini penting: perhitungan ulang butuh info pack dari
         * supplier_ingredients, dan kalau infonya tidak lengkap konversinya
         * gagal lalu MENGGAGALKAN edit yang sebelumnya jalan (termasuk edit
         * harga biasa). Membaca balik faktor juga tahan terhadap master satuan
         * yang berubah setelah penerimaan.
         *
         * Konversi baru dihitung HANYA untuk baris yang benar-benar baru. */
        const grByItemId = new Map(
          grItemsNow.map((g) => [g.purchaseItemId, g] as const),
        );
        const poLinesForMirror = v.items.map((item) => {
          const id = finalItemIds.get(item)!;
          const ing = ingById.get(item.ingredientId)!;
          const prevGr = grByItemId.get(id);
          const prevMv = prevGr?.movementId
            ? movementById.get(prevGr.movementId)
            : undefined;

          let qtyMaster: number | null = null;
          if (prevGr && prevMv) {
            const oldNota = Number(
              prevGr.receivedQtyDecimal ?? prevGr.receivedQty,
            );
            const oldMaster = Math.abs(
              Number(prevMv.qtyDeltaDecimal ?? prevMv.qtyDelta),
            );
            if (oldNota > 0 && oldMaster > 0) {
              qtyMaster = (oldMaster / oldNota) * item.qty;
            }
          }
          if (qtyMaster === null) {
            const conv = resolveQtyToMaster({
              qty: item.qty,
              fromUnit: item.unit?.trim() || ing.unit,
              masterUnit: ing.unit,
              ingredientPacks:
                (ing.packConversions as
                  | Array<{ unitLabel: string; qtyPerBase: number }>
                  | null) ?? null,
              unitBelanja: ing.unitBelanja,
              unitBelanjaPerCogs: ing.unitBelanjaPerCogs,
            });
            if (!conv.ok || conv.qtyMaster === null) {
              throw new Error(
                `UNIT_ERROR:${ing.name}:satuan "${item.unit?.trim() || ing.unit}" belum punya konversi ke ${ing.unit}. Lengkapi di Kelola Bahan dulu.`,
              );
            }
            qtyMaster = conv.qtyMaster;
          }

          return {
            purchaseItemId: id,
            ingredientId: item.ingredientId,
            qtyNota: item.qty,
            qtyMaster,
            unitCost: item.unitCost,
            ingredientName: ing.name,
            unitSnapshot: ing.unit,
            sectionSnapshot: ing.section ?? null,
          };
        });

        const grLinesForMirror = grItemsNow.map((g) => {
          const mv = g.movementId ? movementById.get(g.movementId) : undefined;
          return {
            grItemId: g.id,
            purchaseItemId: g.purchaseItemId,
            movementId: g.movementId,
            movementQtyMaster: mv
              ? Math.abs(Number(mv.qtyDeltaDecimal ?? mv.qtyDelta))
              : 0,
            /* Tanpa movement dianggap ber-skip: tidak ada stok yang tersentuh. */
            movementSkipped: mv ? mv.skippedStockUpdate : true,
            ingredientId: g.ingredientId,
          };
        });

        const actions = planGrMirror(poLinesForMirror, grLinesForMirror);

        /* Pembelian era PERPETUAL (movement-nya benar-benar menambah stok)
         * ditolak kalau qty-nya berubah atau barisnya dibuang. Merambatkan
         * qty di sana berarti ikut membongkar nilai persediaan & HPP rata-rata
         * yang sudah terpakai laporan — kelas drift yang direkonsiliasi manual
         * di audit AE-181. Lebih jujur menolak dan menyuruh batalkan-catat-ulang
         * daripada diam-diam menggeser nilai persediaan.
         * Mode periodic yang berlaku sekarang selalu ber-skip → tidak kena. */
        for (const a of actions) {
          if (a.kind !== "insert" && a.stockDelta !== 0) {
            throw new Error("LEGACY_STOCK_LOCKED");
          }
        }

        for (const a of actions) {
          if (a.kind === "delete") {
            await tx
              .delete(goodsReceiptItems)
              .where(eq(goodsReceiptItems.id, a.grItemId));
            if (a.movementId) {
              /* Lepaskan dulu tautan dari baris PO (FK kedua ke pergerakan
               * yang sama), kalau tidak penghapusan pergerakan ditolak. */
              await tx
                .update(purchaseItems)
                .set({ movementId: null })
                .where(eq(purchaseItems.movementId, a.movementId));
              await tx
                .delete(inventoryMovements)
                .where(eq(inventoryMovements.id, a.movementId));
            }
            continue;
          }

          if (a.kind === "update") {
            await tx
              .update(goodsReceiptItems)
              .set({
                receivedQty: Math.max(1, Math.round(a.receivedQtyNota)),
                receivedQtyDecimal: a.receivedQtyNota.toFixed(4),
              })
              .where(eq(goodsReceiptItems.id, a.grItemId));
            if (a.movementId) {
              await tx
                .update(inventoryMovements)
                .set({
                  qtyDelta: Math.max(1, Math.round(a.qtyMaster)),
                  qtyDeltaDecimal: a.qtyMaster.toFixed(4),
                })
                .where(eq(inventoryMovements.id, a.movementId));
            }
            continue;
          }

          /* Baris baru: buat pergerakan + baris penerimaannya. Flag skip
           * mengikuti pergerakan yang sudah ada di GR ini supaya satu
           * penerimaan tidak setengah menyentuh stok setengah tidak. */
          const skipStock = movementRows.length > 0
            ? movementRows.every((m) => m.skippedStockUpdate)
            : true;
          const [mv] = await tx
            .insert(inventoryMovements)
            .values({
              outletId: session.user.outletId,
              ingredientId: a.ingredientId,
              kind: "purchase",
              qtyDelta: Math.max(1, Math.round(a.qtyMaster)),
              qtyDeltaDecimal: a.qtyMaster.toFixed(4),
              /* Per satuan DASAR, bukan per satuan nota. `a.unitCost` adalah
               * Rp/galon; pergerakan menyimpan Rp/ml. Kalau dipakai mentah,
               * harga per ml jadi 25.000× lipat dan mencemari HPP. */
              unitCostAtMovement:
                a.qtyMaster > 0 ? Math.round(a.lineTotal / a.qtyMaster) : 0,
              referenceType: "manual",
              referenceId: po.id,
              skippedStockUpdate: skipStock,
              reason: `Tambahan baris dari koreksi PO ${po.invoiceNo ?? po.id.slice(0, 8)}`,
              createdBy: session.user.id,
            })
            .returning({ id: inventoryMovements.id });
          await tx.insert(goodsReceiptItems).values({
            goodsReceiptId: gr.id,
            purchaseItemId: a.purchaseItemId,
            ingredientId: a.ingredientId,
            receivedQty: Math.max(1, Math.round(a.receivedQtyNota)),
            receivedQtyDecimal: a.receivedQtyNota.toFixed(4),
            unitCost: a.unitCost,
            /* Nilai awal 0 supaya blok penyesuaian di bawah membacanya sebagai
             * "belum bernilai" dan menghitung selisihnya utuh. */
            totalCost: 0,
            movementId: mv.id,
            ingredientNameSnapshot: a.ingredientName,
            unitSnapshot: a.unitSnapshot,
            sectionSnapshot: a.sectionSnapshot,
          });
        }
      }

      // ---- Sinkronkan turunan GR (mode harga-saja) ----
      let lastExpenseId: string | null = null;
      if (priceOnly) {
        const costByItemId = new Map<string, number>();
        for (const item of v.items) {
          /* Sesi AE-200 — pakai id FINAL, bukan item.id, supaya baris yang
           * baru ditambah ikut dapat harga (dulu baris baru terlewat). */
          const id = finalItemIds.get(item);
          if (id) costByItemId.set(id, item.unitCost);
        }
        const isTop = po.paymentMethod === "top";
        const label = po.invoiceNo ?? `purchase ${po.id.slice(0, 8)}`;

        for (const gr of grRows) {
          const grItems = await tx
            .select()
            .from(goodsReceiptItems)
            .where(eq(goodsReceiptItems.goodsReceiptId, gr.id));

          let grTotal = 0;
          const bySection = new Map<string, number>();
          for (const gi of grItems) {
            const newUnitCost = costByItemId.get(gi.purchaseItemId);
            if (newUnitCost === undefined) continue;
            const rawQty = Number(gi.receivedQtyDecimal ?? gi.receivedQty);
            const newLineTotal = Math.round(rawQty * newUnitCost);
            const oldLineTotal = Number(gi.totalCost);
            grTotal += newLineTotal;
            const key = gi.sectionSnapshot ?? "null";
            bySection.set(key, (bySection.get(key) ?? 0) + newLineTotal);

            await tx
              .update(goodsReceiptItems)
              .set({ unitCost: newUnitCost, totalCost: newLineTotal })
              .where(eq(goodsReceiptItems.id, gi.id));

            if (!gi.movementId) continue;
            const [mv] = await tx
              .select()
              .from(inventoryMovements)
              .where(eq(inventoryMovements.id, gi.movementId))
              .for("update")
              .limit(1);
            if (!mv) continue;
            /* Faktor konversi tidak dihitung ulang — cukup dibaca balik dari
             * data yang sudah tersimpan (qty master di movement vs qty nota
             * di baris GR). Aman terhadap perubahan master satuan setelahnya. */
            const masterQty = Math.abs(
              Number(mv.qtyDeltaDecimal ?? mv.qtyDelta),
            );
            if (masterQty > 0) {
              await tx
                .update(inventoryMovements)
                .set({
                  unitCostAtMovement: Math.max(
                    0,
                    Math.round(newLineTotal / masterQty),
                  ),
                })
                .where(eq(inventoryMovements.id, mv.id));
            }

            /* HPP rata-rata: hanya kalau movement ini memang menambah stok.
             * Mode periodic (stok cuma dari opname) → skippedStockUpdate=true
             * → tidak ada nilai persediaan yang perlu dikoreksi. */
            if (mv.skippedStockUpdate) continue;
            const deltaValue = newLineTotal - oldLineTotal;
            if (deltaValue === 0) continue;
            const [ing] = await tx
              .select()
              .from(ingredients)
              .where(eq(ingredients.id, gi.ingredientId))
              .for("update")
              .limit(1);
            if (!ing) continue;
            const stockNow = Number(ing.currentStockDecimal ?? ing.currentStock);
            if (!(stockNow > 0)) continue;
            const oldCost = ing.costPerUnit;
            const newCost = Math.max(
              0,
              Math.round(oldCost + deltaValue / stockNow),
            );
            if (newCost === oldCost) continue;
            await tx
              .update(ingredients)
              .set({
                costPerUnit: newCost,
                costLastChangedAt: new Date(),
                updatedAt: new Date(),
                updatedBy: session.user.id,
              })
              .where(eq(ingredients.id, ing.id));
            await tx.insert(ingredientCostHistory).values({
              outletId: session.user.outletId,
              ingredientId: ing.id,
              oldCostPerUnit: oldCost,
              newCostPerUnit: newCost,
              triggerType: "purchase_wac",
              triggerRefType: "purchase",
              triggerRefId: po.id,
              changedQty: masterQty.toFixed(4),
              changedValue: deltaValue,
              actorId: session.user.id,
              notes: `Koreksi harga PO ${label}`,
            });
            try {
              await cascadeCostUpdate(
                tx,
                session.user.outletId,
                ing.id,
                session.user.id,
              );
            } catch {
              // fail-soft — koreksi HPP turunan resep tidak boleh gagalkan edit
            }
          }

          // Expense kas per GR (non-TOP saja; TOP baru keluar uang saat lunas).
          let expenseId: string | null = gr.expenseId;
          if (!isTop) {
            const [existingExpense] = expenseId
              ? await tx
                  .select()
                  .from(expenses)
                  .where(
                    and(eq(expenses.id, expenseId), isNull(expenses.deletedAt)),
                  )
                  .limit(1)
              : [undefined];

            if (existingExpense && grTotal > 0) {
              await tx
                .update(expenses)
                .set({
                  amount: grTotal,
                  expenseDate: gr.receivedDate,
                  updatedAt: new Date(),
                  updatedBy: session.user.id,
                })
                .where(eq(expenses.id, existingExpense.id));
              expensesTouched += 1;
            } else if (existingExpense && grTotal <= 0) {
              /* expenses.amount punya CHECK > 0 — nilai nol harus dihapus,
               * bukan di-set 0. */
              await tx
                .update(expenses)
                .set({
                  deletedAt: new Date(),
                  deletedBy: session.user.id,
                  updatedAt: new Date(),
                  updatedBy: session.user.id,
                })
                .where(eq(expenses.id, existingExpense.id));
              expenseId = null;
              expensesTouched += 1;
            } else if (!existingExpense && grTotal > 0) {
              const [defaultCat] = await tx
                .select()
                .from(expenseCategories)
                .where(
                  and(
                    eq(expenseCategories.outletId, session.user.outletId),
                    isNull(expenseCategories.deletedAt),
                  ),
                )
                .orderBy(asc(expenseCategories.displayOrder))
                .limit(1);
              if (defaultCat) {
                const [exp] = await tx
                  .insert(expenses)
                  .values({
                    outletId: session.user.outletId,
                    expenseDate: gr.receivedDate,
                    categoryId: defaultCat.id,
                    description: `Belanja ${paymentMethodLabel(
                      po.paymentMethod,
                    )} — ${buildPurchaseLabel({
                      supplierName: await resolveSupplierName(po.supplierId),
                      invoiceNo: po.invoiceNo,
                      receiptDate: String(gr.receivedDate),
                    })}`,
                    amount: grTotal,
                    paymentMethod: expensePaymentMethod(po.paymentMethod),
                    sourceType: "purchase",
                    purchaseId: po.id,
                    createdBy: session.user.id,
                  })
                  .returning({ id: expenses.id });
                expenseId = exp.id;
                expensesTouched += 1;
              }
            }
          }

          await tx
            .update(goodsReceipts)
            .set({ totalAmount: grTotal, expenseId })
            .where(eq(goodsReceipts.id, gr.id));
          if (expenseId) lastExpenseId = expenseId;
          receiptsResynced += 1;

          journalJobs.push({
            goodsReceiptId: gr.id,
            paymentMethod: po.paymentMethod,
            total: grTotal,
            entryDate: String(gr.receivedDate),
            lines: Array.from(bySection.entries()).map(([key, amount]) => ({
              section: (key === "null" ? null : key) as
                | "kitchen"
                | "bar"
                | "supporting"
                | "cleaning"
                | null,
              amount,
            })),
          });
        }
      }

      // ---- Header ----
      const isTop = v.paymentMethod === "top";
      const dueDate = isTop
        ? addDaysIso(v.purchaseDate, v.paymentTermDays)
        : null;
      const urls =
        v.receiptImageUrls && v.receiptImageUrls.length > 0
          ? v.receiptImageUrls
          : null;
      await tx
        .update(purchases)
        .set({
          supplierId: v.supplierId,
          purchaseDate: v.purchaseDate,
          paymentMethod: v.paymentMethod,
          paymentTermDays: v.paymentTermDays,
          dueDate,
          invoiceNo: v.invoiceNo ?? null,
          notes: v.notes ?? null,
          receiptImageUrl: urls ? urls[0] : null,
          receiptImageUrls: urls,
          totalAmount: total,
          /* Backlink kas menunjuk expense GR terakhir yang masih hidup. */
          expenseId: priceOnly ? lastExpenseId : po.expenseId,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(purchases.id, po.id));
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return fail("NOT_FOUND", "PO tidak ditemukan");
    if (msg === "CANCELLED")
      return fail("BAD_STATE", "PO sudah dibatalkan — tidak bisa diedit");
    if (msg === "ALREADY_SETTLED")
      return fail(
        "BAD_STATE",
        "Hutang TOP ini sudah ditandai lunas. Nilainya sudah dipakai jurnal pelunasan, jadi tidak bisa diedit lagi.",
      );
    if (msg.startsWith("PERIOD_LOCKED:"))
      return fail(
        "BAD_STATE",
        `Barang PO ini diterima di periode ${msg.slice("PERIOD_LOCKED:".length)} yang sudah dikunci — jurnalnya tidak bisa diperbarui. Buka periode itu dulu di menu Akuntansi kalau harganya memang harus dikoreksi.`,
      );
    if (msg === "LEGACY_INSTANT")
      return fail(
        "BAD_STATE",
        "Ini pembelian langsung (bukan PO), bukan lewat alur Terima Barang. Batalkan lalu catat ulang kalau ada yang salah.",
      );
    /* Sesi AE-200 — METHOD_LOCKED / SUPPLIER_LOCKED / LINES_LOCKED /
     * QTY_LOCKED / UNIT_LOCKED sudah tidak dilempar lagi: perubahannya kini
     * dirambatkan ke baris penerimaan. Dua penolakan baru menggantikannya. */
    /* Sesi AE-200b — `UNIT_ERROR:` WAJIB dipetakan. Tanpa ini pesannya jatuh
     * ke "Gagal menyimpan perubahan PO" yang generik: owner tidak tahu bahan
     * mana yang bermasalah, dan saya sendiri harus menebak-nebak saat
     * ditanya. Format: UNIT_ERROR:<bahan>:<penjelasan>. */
    if (msg.startsWith("UNIT_ERROR:")) {
      const rest = msg.slice("UNIT_ERROR:".length);
      const sep = rest.indexOf(":");
      const bahan = sep > 0 ? rest.slice(0, sep) : rest;
      const detail = sep > 0 ? rest.slice(sep + 1) : "satuannya tidak bisa dikonversi";
      return fail("VALIDATION_ERROR", `Bahan "${bahan}": ${detail}`);
    }
    if (msg === "MULTI_GR")
      return fail(
        "BAD_STATE",
        "PO ini barangnya diterima lebih dari sekali (penerimaan bertahap), jadi sistem tidak bisa memutuskan penerimaan mana yang harus ikut berubah. Batalkan penerimaannya dulu lewat Daftar Penerimaan, baru edit PO-nya.",
      );
    if (msg === "LEGACY_STOCK_LOCKED")
      return fail(
        "BAD_STATE",
        "Pembelian ini dari periode ketika stok masih ditambah langsung oleh pembelian, jadi qty-nya sudah terpakai di nilai persediaan & HPP. Mengubahnya bisa menggeser laporan yang sudah jadi. Harga masih boleh dikoreksi; kalau qty/itemnya yang salah, batalkan pembelian ini lalu catat ulang.",
      );
    if (msg === "INGREDIENT_NOT_FOUND")
      return fail("NOT_FOUND", "Salah satu bahan tidak ditemukan / non-aktif");
    if (msg === "OUTLET_MISMATCH")
      return fail("FORBIDDEN", "Bahan dari outlet lain — kontak admin");
    if (msg === "PR_ITEM_NOT_FOUND")
      return fail("NOT_FOUND", "Item Permintaan Belanja tidak ditemukan");
    if (msg === "PR_NOT_FOUND")
      return fail("NOT_FOUND", "Permintaan Belanja tidak ditemukan");
    if (msg.startsWith("PR_CANCELLED:"))
      return fail(
        "CONFLICT",
        `Bahan "${msg.slice("PR_CANCELLED:".length)}": Permintaan Belanja-nya sudah dibatalkan`,
      );
    if (msg.startsWith("PR_ITEM_REJECTED:"))
      return fail(
        "CONFLICT",
        `Bahan "${msg.slice("PR_ITEM_REJECTED:".length)}": item PR sudah ditolak`,
      );
    if (msg.startsWith("PR_ITEM_ALREADY_BOUGHT:"))
      return fail(
        "CONFLICT",
        `Bahan "${msg.slice("PR_ITEM_ALREADY_BOUGHT:".length)}": item PR ini sudah pernah dibeli`,
      );
    if (msg.startsWith("PR_ITEM_ALREADY_LINKED:"))
      return fail(
        "CONFLICT",
        `Bahan "${msg.slice("PR_ITEM_ALREADY_LINKED:".length)}": item PR ini sudah ditarik ke PO lain`,
      );
    if (msg.startsWith("PR_ITEM_MISMATCH:"))
      return fail(
        "CONFLICT",
        `Bahan "${msg.slice("PR_ITEM_MISMATCH:".length)}": tautan Permintaan Belanja-nya untuk bahan lain. Hapus baris ini lalu tambah baris baru kalau memang mau ganti bahan.`,
      );
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "purchases.order_update", "Gagal menyimpan perubahan PO"),
    );
  }

  await logAudit({
    eventType: "purchase.order_update",
    userId: session.user.id,
    entityType: "purchase",
    entityId: v.id,
    payload: {
      summary: `Edit PO — total ${oldTotalAmount} → ${newTotalAmount} (${v.items.length} item${
        priceOnly ? ", mode harga-saja" : ""
      })`,
      context: {
        priceOnly,
        oldTotalAmount,
        newTotalAmount,
        receiptsResynced,
        expensesTouched,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  if (journalJobs.length > 0) {
    const { fireJournalHook, resyncJournalForGoodsReceipt } = await import(
      "@/features/accounting/hooks"
    );
    for (const job of journalJobs) {
      fireJournalHook(
        async () =>
          resyncJournalForGoodsReceipt({
            outletId: session.user.outletId,
            purchaseId: v.id,
            goodsReceiptId: job.goodsReceiptId,
            purchaseLabel: await resolvePurchaseLabel(v.id, {
              receiptDate: job.entryDate,
            }),
            paymentMethod: job.paymentMethod,
            total: job.total,
            lines: job.lines,
            entryDate: job.entryDate,
            actorId: session.user.id,
          }),
        "purchase_create",
        { sourceId: job.goodsReceiptId, outletId: session.user.outletId },
      );
    }
  }

  return ok({
    id: v.id,
    totalAmount: newTotalAmount,
    receiptsResynced,
    expensesTouched,
    priceOnly,
  });
}

/**
 * Goods Receive (GR) — terima barang dari PO yang masih 'ordered'.
 * Di sinilah expense ("kolom pembelian") bertambah + (stok kalau perpetual) +
 * PR receivedQty bump + jurnal. Mirror efek createPurchase, pakai tanggal hari
 * ini (WIB) sebagai tanggal terima untuk anti-double-count & expense.
 */
export async function confirmGoodsReceipt(input: {
  id: string;
}): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.goods_receive")) {
    return fail("FORBIDDEN", "Tidak punya hak terima barang");
  }
  if (!input?.id) return fail("VALIDATION_ERROR", "ID PO tidak valid");

  const grDate = toJakartaDateOnly(new Date());

  try {
    await db.transaction(async (tx) => {
      const [po] = await tx
        .select()
        .from(purchases)
        .where(
          and(
            eq(purchases.id, input.id),
            eq(purchases.outletId, session.user.outletId),
          ),
        )
        .for("update")
        .limit(1);
      if (!po) throw new Error("NOT_FOUND");
      if (po.receiptStatus !== "ordered") throw new Error("BAD_STATE");

      const isTop = po.paymentMethod === "top";

      // Load items + lock ingredients.
      const poItems = await tx
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, po.id));
      const ingIds = poItems.map((i) => i.ingredientId);
      const ingRows =
        ingIds.length > 0
          ? await tx
              .select()
              .from(ingredients)
              .where(inArray(ingredients.id, ingIds))
              .for("update")
          : [];
      const ingById = new Map(ingRows.map((r) => [r.id, r] as const));

      // Pack info dari supplier (sama seperti createPurchase) untuk konversi.
      const packMap = new Map<string, PackInfo>();
      if (po.supplierId && ingIds.length > 0) {
        const packRows = await tx
          .select({
            ingredientId: supplierIngredients.ingredientId,
            packSize: supplierIngredients.packSize,
            packUnit: supplierIngredients.packUnit,
          })
          .from(supplierIngredients)
          .where(
            and(
              eq(supplierIngredients.outletId, session.user.outletId),
              eq(supplierIngredients.supplierId, po.supplierId),
              inArray(supplierIngredients.ingredientId, ingIds),
              isNull(supplierIngredients.deletedAt),
            ),
          );
        for (const r of packRows) {
          const size = parseFloat(r.packSize);
          if (Number.isFinite(size) && size > 0) {
            packMap.set(r.ingredientId, { packSize: size, packUnit: r.packUnit });
          }
        }
      }

      // Anti-double-count vs opname pakai tanggal GR (hari ini).
      const lastOpname = await fetchLastFinalizedOpname(session.user.outletId);
      const backdateStatus = classifyPurchaseAgainstOpname({
        purchaseDateIso: grDate,
        lastOpnameFinalizedAt: lastOpname?.finalizedAt ?? null,
      });
      const { addOnPurchase } = await getStockMode(session.user.outletId);
      const skipStockEffect =
        shouldSkipStockUpdate(backdateStatus) || !addOnPurchase;

      // Per item: resolve konversi → movement (+ stok/WAC kalau perpetual).
      /* Sesi AE-177 — catatan GR kanonik + bump received_qty (DULU confirmGR
       * tak isi keduanya → tab GR kosong + received_qty stale). Full-receive:
       * received = ordered. */
      const grItemRows: Array<{
        purchaseItemId: string;
        ingredientId: string;
        receivedQty: number;
        receivedQtyDecimal: string;
        unitCost: number;
        totalCost: number;
        movementId: string;
        ingredientNameSnapshot: string;
        unitSnapshot: string;
        sectionSnapshot: string | null;
      }> = [];
      for (const it of poItems) {
        const ing = ingById.get(it.ingredientId);
        if (!ing) continue;

        const existingPacks =
          (ing.packConversions as
            | Array<{ unitLabel: string; qtyPerBase: number }>
            | null) ?? [];
        const tierPacks: Array<{ unitLabel: string; qtyPerBase: number }> = [];
        if (ing.unitBelanja && ing.unitBelanjaPerCogs) {
          const per = parseFloat(ing.unitBelanjaPerCogs);
          if (Number.isFinite(per) && per > 0)
            tierPacks.push({ unitLabel: ing.unitBelanja, qtyPerBase: per });
        }
        if (ing.unitTracking && ing.unitTrackingPerCogs) {
          const per = parseFloat(ing.unitTrackingPerCogs);
          if (Number.isFinite(per) && per > 0)
            tierPacks.push({ unitLabel: ing.unitTracking, qtyPerBase: per });
        }
        const mergedPacks = mergePackConversions(existingPacks, tierPacks);

        const rawQty = parseFloat(it.qtyDecimal ?? "") || it.qty;
        const conv = convertPurchaseQty({
          qty: rawQty,
          fromUnit: it.unitOverride ?? it.unitSnapshot ?? ing.unit,
          masterUnit: ing.unit,
          pack: packMap.get(it.ingredientId) ?? null,
          ingredientPacks: mergedPacks,
        });
        if (!conv.ok) throw new Error(`UNIT_ERROR:${ing.name}:${conv.message}`);

        const qtyMaster = conv.qtyMaster;
        const unitCostMaster = Math.max(
          0,
          Math.round(it.unitCost / conv.costFactor),
        );
        const totalCostMaster = Math.round(qtyMaster * unitCostMaster);
        const movementDelta = formatMovementDelta(qtyMaster);

        if (!skipStockEffect) {
          const newStock = computeNewStock({
            currentBigint: ing.currentStock,
            currentDecimal: ing.currentStockDecimal,
            delta: qtyMaster,
          });
          const oldCostBefore = ing.costPerUnit;
          const wac = computeNewWac({
            oldQty: Number(ing.currentStockDecimal ?? 0),
            oldCost: oldCostBefore,
            purchaseQty: qtyMaster,
            purchaseTotal: totalCostMaster,
          });
          const newWacCost = wac.newCost;
          const costChanged = newWacCost !== oldCostBefore;
          const updateValues: Record<string, unknown> = {
            currentStock: newStock.bigint,
            currentStockDecimal: newStock.decimal,
            costPerUnit: newWacCost,
            updatedAt: new Date(),
            updatedBy: session.user.id,
          };
          if (costChanged) updateValues.costLastChangedAt = new Date();
          await tx
            .update(ingredients)
            .set(updateValues)
            .where(eq(ingredients.id, it.ingredientId));
          // refresh in-memory cost so next item with same ingredient is correct
          ingById.set(it.ingredientId, {
            ...ing,
            currentStock: newStock.bigint,
            currentStockDecimal: newStock.decimal,
            costPerUnit: newWacCost,
          });
          if (costChanged) {
            await tx.insert(ingredientCostHistory).values({
              outletId: session.user.outletId,
              ingredientId: it.ingredientId,
              oldCostPerUnit: oldCostBefore,
              newCostPerUnit: newWacCost,
              triggerType: "purchase_wac",
              triggerRefType: "purchase",
              triggerRefId: po.id,
              changedQty: qtyMaster.toFixed(4),
              changedValue: totalCostMaster,
              actorId: session.user.id,
              notes: `GR ${po.invoiceNo ?? po.id.slice(0, 8)}`,
            });
            try {
              await cascadeCostUpdate(
                tx,
                session.user.outletId,
                it.ingredientId,
                session.user.id,
              );
            } catch {
              // fail-soft
            }
          }
        }

        const [movement] = await tx
          .insert(inventoryMovements)
          .values({
            outletId: session.user.outletId,
            ingredientId: it.ingredientId,
            kind: "purchase",
            qtyDelta: movementDelta.bigint,
            qtyDeltaDecimal: movementDelta.decimal,
            unitCostAtMovement: unitCostMaster,
            referenceType: "manual",
            referenceId: po.id,
            reason: `GR ${po.invoiceNo ?? po.id.slice(0, 8)}${
              skipStockEffect ? " (no stock add)" : ""
            }`,
            skippedStockUpdate: skipStockEffect,
            createdBy: session.user.id,
          })
          .returning({ id: inventoryMovements.id });

        /* Full-receive: received_qty = ordered (rawQty). Sebelumnya cuma set
         * movementId → received_qty stale (bug). */
        const recvBigint = Math.max(1, Math.round(rawQty));
        await tx
          .update(purchaseItems)
          .set({
            movementId: movement.id,
            receivedQty: recvBigint,
            receivedQtyDecimal: rawQty.toFixed(4),
          })
          .where(eq(purchaseItems.id, it.id));

        grItemRows.push({
          purchaseItemId: it.id,
          ingredientId: it.ingredientId,
          receivedQty: recvBigint,
          receivedQtyDecimal: rawQty.toFixed(4),
          unitCost: it.unitCost,
          totalCost: it.totalCost,
          movementId: movement.id,
          ingredientNameSnapshot: it.ingredientNameSnapshot,
          unitSnapshot: it.unitSnapshot,
          sectionSnapshot: it.sectionSnapshot,
        });
      }

      // PR receivedQty bump + status auto-promote.
      const prItemIds = poItems
        .map((i) => i.purchaseRequestItemId)
        .filter((id): id is string => Boolean(id));
      if (prItemIds.length > 0) {
        const prItemRows = await tx
          .select()
          .from(purchaseRequestItems)
          .where(inArray(purchaseRequestItems.id, prItemIds))
          .for("update");
        const prItemMap = new Map(prItemRows.map((r) => [r.id, r] as const));
        const requestIds = Array.from(
          new Set(prItemRows.map((r) => r.requestId)),
        );
        for (const it of poItems) {
          if (!it.purchaseRequestItemId) continue;
          const prItem = prItemMap.get(it.purchaseRequestItemId);
          if (!prItem) continue;
          const ing = ingById.get(it.ingredientId);
          const rawQty = parseFloat(it.qtyDecimal ?? "") || it.qty;
          // best-effort master qty (sama unit kalau resolve gagal)
          let addQtyDecimal = rawQty;
          if (ing) {
            const conv = convertPurchaseQty({
              qty: rawQty,
              fromUnit: it.unitOverride ?? it.unitSnapshot ?? ing.unit,
              masterUnit: ing.unit,
              pack: packMap.get(it.ingredientId) ?? null,
              ingredientPacks: [],
            });
            if (conv.ok) addQtyDecimal = conv.qtyMaster;
          }
          const addQty = Math.max(1, Math.round(addQtyDecimal));
          const newReceivedQty = Number(prItem.receivedQty) + addQty;
          const newDecimal = (
            (prItem.receivedQtyDecimal ? Number(prItem.receivedQtyDecimal) : 0) +
            addQtyDecimal
          ).toFixed(4);
          await tx
            .update(purchaseRequestItems)
            .set({
              receivedQty: newReceivedQty,
              receivedQtyDecimal: newDecimal,
              updatedAt: new Date(),
            })
            .where(eq(purchaseRequestItems.id, prItem.id));
          prItemMap.set(prItem.id, {
            ...prItem,
            receivedQty: newReceivedQty,
            receivedQtyDecimal: newDecimal,
          });
        }
        for (const requestId of requestIds) {
          const allItems = await tx
            .select()
            .from(purchaseRequestItems)
            .where(eq(purchaseRequestItems.requestId, requestId));
          const newStatus = computePrStatus(
            allItems.map((r) => ({
              requestedQty: Number(r.requestedQty),
              receivedQty: Number(r.receivedQty),
              rejectedAt: r.rejectedAt,
            })),
          );
          const [pr] = await tx
            .select()
            .from(purchaseRequests)
            .where(eq(purchaseRequests.id, requestId))
            .limit(1);
          const updates: Record<string, unknown> = { updatedAt: new Date() };
          if (pr && newStatus !== pr.status && newStatus !== "cancelled") {
            updates.status = newStatus;
            if (newStatus === "completed") updates.completedAt = new Date();
          }
          await tx
            .update(purchaseRequests)
            .set(updates)
            .where(eq(purchaseRequests.id, requestId));
        }
      }

      // Expense (pencatatan pengeluaran) — non-TOP saja, tanggal GR.
      let expenseId: string | null = null;
      if (!isTop) {
        const [defaultCat] = await tx
          .select()
          .from(expenseCategories)
          .where(
            and(
              eq(expenseCategories.outletId, session.user.outletId),
              isNull(expenseCategories.deletedAt),
            ),
          )
          .orderBy(asc(expenseCategories.displayOrder))
          .limit(1);
        if (defaultCat) {
          const [exp] = await tx
            .insert(expenses)
            .values({
              outletId: session.user.outletId,
              expenseDate: grDate,
              categoryId: defaultCat.id,
              description: `Belanja ${paymentMethodLabel(po.paymentMethod)} — ${buildPurchaseLabel(
                {
                  supplierName: await resolveSupplierName(po.supplierId),
                  invoiceNo: po.invoiceNo,
                  receiptDate: grDate,
                },
              )}`,
              amount: po.totalAmount,
              paymentMethod: expensePaymentMethod(po.paymentMethod),
              sourceType: "purchase",
              purchaseId: po.id,
              createdBy: session.user.id,
            })
            .returning({ id: expenses.id });
          expenseId = exp.id;
        }
      }

      /* Sesi AE-177 — catatan GR kanonik (full receive PO). Tab GR kini lengkap
       * + received_qty per line sudah di-bump di loop atas. */
      if (grItemRows.length > 0) {
        const [gr] = await tx
          .insert(goodsReceipts)
          .values({
            outletId: session.user.outletId,
            purchaseId: po.id,
            receivedDate: grDate,
            totalAmount: po.totalAmount,
            expenseId: expenseId ?? po.expenseId,
            createdBy: session.user.id,
          })
          .returning({ id: goodsReceipts.id });
        for (const r of grItemRows) {
          await tx.insert(goodsReceiptItems).values({
            goodsReceiptId: gr!.id,
            purchaseItemId: r.purchaseItemId,
            ingredientId: r.ingredientId,
            receivedQty: r.receivedQty,
            receivedQtyDecimal: r.receivedQtyDecimal,
            unitCost: r.unitCost,
            totalCost: r.totalCost,
            movementId: r.movementId,
            ingredientNameSnapshot: r.ingredientNameSnapshot,
            unitSnapshot: r.unitSnapshot,
            sectionSnapshot: r.sectionSnapshot,
          });
        }
      }

      // Finalisasi header: received + pembayaran.
      await tx
        .update(purchases)
        .set({
          receiptStatus: "received",
          receivedAt: new Date(),
          status: isTop ? "pending_payment" : "paid",
          paidAt: isTop ? null : new Date(),
          paidBy: isTop ? null : session.user.id,
          expenseId: expenseId ?? po.expenseId,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(purchases.id, po.id));
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return fail("NOT_FOUND", "PO tidak ditemukan");
    if (msg === "BAD_STATE")
      return fail("BAD_STATE", "PO sudah diterima / dibatalkan");
    if (msg.startsWith("UNIT_ERROR:")) {
      const rest = msg.slice("UNIT_ERROR:".length);
      const sep = rest.indexOf(":");
      const ingName = sep > 0 ? rest.slice(0, sep) : "?";
      const userMsg = sep > 0 ? rest.slice(sep + 1) : rest;
      return fail("VALIDATION_ERROR", `Bahan "${ingName}": ${userMsg}`);
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "purchases.goods_receive", "Gagal terima barang"),
    );
  }

  await logAudit({
    eventType: "purchase.goods_receive",
    userId: session.user.id,
    entityType: "purchase",
    entityId: input.id,
    payload: { summary: `Goods Receive PO ${input.id.slice(0, 8)} (${grDate})` },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  // Jurnal akuntansi (post-commit) — tanggal GR.
  {
    const items = await db
      .select({
        section: purchaseItems.sectionSnapshot,
        totalCost: purchaseItems.totalCost,
      })
      .from(purchaseItems)
      .where(eq(purchaseItems.purchaseId, input.id));
    const bySection = new Map<string, number>();
    for (const it of items) {
      const key = it.section ?? "null";
      bySection.set(key, (bySection.get(key) ?? 0) + Number(it.totalCost));
    }
    const sectionLines = Array.from(bySection.entries()).map(([key, amount]) => ({
      section: (key === "null" ? null : key) as
        | "kitchen"
        | "bar"
        | "supporting"
        | "cleaning"
        | null,
      amount,
    }));
    const [poRow] = await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, input.id))
      .limit(1);
    if (poRow) {
      const { fireJournalHook, postJournalForPurchaseCreate } = await import(
        "@/features/accounting/hooks"
      );
      fireJournalHook(
        async () =>
          postJournalForPurchaseCreate({
            outletId: session.user.outletId,
            purchaseId: input.id,
            purchaseLabel: await resolvePurchaseLabel(input.id, {
              receiptDate: grDate,
            }),
            paymentMethod: poRow.paymentMethod,
            total: poRow.totalAmount,
            lines: sectionLines,
            entryDate: grDate,
            actorId: session.user.id,
          }),
        "purchase_create",
      );
    }
  }

  return ok({ id: input.id });
}

/**
 * Sesi AE-173 — daftar PO yang masih 'ordered' (untuk Goods Receive).
 * Staff-callable (purchase.goods_receive) supaya bisa dipakai dari aplikasi POS.
 */
export async function listPendingGoodsReceipts(): Promise<
  ApiResult<
    Array<{
      id: string;
      purchaseDate: string;
      supplierName: string | null;
      paymentMethod: PaymentMethod;
      totalAmount: number;
      itemCount: number;
    }>
  >
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.goods_receive")) {
    return fail("FORBIDDEN", "Tidak punya hak terima barang");
  }
  const rows = await db
    .select({
      id: purchases.id,
      purchaseDate: purchases.purchaseDate,
      supplierName: suppliers.name,
      paymentMethod: purchases.paymentMethod,
      totalAmount: purchases.totalAmount,
      /* Sesi AE-192 — literal ber-prefix tabel; `${purchases.id}` di posisi
       * SELECT di-render `"id"` polos → ke-tangkap purchase_items.id → 0. */
      itemCount: sql<number>`(
        select count(*)::int from purchase_items pi
        where pi.purchase_id = purchases.id
      )`,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(
      and(
        eq(purchases.outletId, session.user.outletId),
        inArray(purchases.receiptStatus, ["ordered", "partial"]),
      ),
    )
    .orderBy(desc(purchases.purchaseDate), desc(purchases.createdAt));
  return ok(rows);
}

/**
 * Sesi AE-173 — detail PO untuk modal GR: header + item dengan qty dipesan,
 * sudah diterima, dan sisa. Hanya PO 'ordered'/'partial'. Staff-callable.
 */
export async function fetchReceivablePurchase(
  purchaseId: string,
): Promise<
  ApiResult<{
    id: string;
    supplierName: string | null;
    purchaseDate: string;
    paymentMethod: PaymentMethod;
    receiptStatus: string;
    items: Array<{
      purchaseItemId: string;
      ingredientName: string;
      unit: string;
      orderedQty: number;
      receivedQty: number;
      remainingQty: number;
      unitCost: number;
    }>;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.goods_receive")) {
    return fail("FORBIDDEN", "Tidak punya hak terima barang");
  }
  const [po] = await db
    .select({
      id: purchases.id,
      supplierName: suppliers.name,
      purchaseDate: purchases.purchaseDate,
      paymentMethod: purchases.paymentMethod,
      receiptStatus: purchases.receiptStatus,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(
      and(
        eq(purchases.id, purchaseId),
        eq(purchases.outletId, session.user.outletId),
      ),
    )
    .limit(1);
  if (!po) return fail("NOT_FOUND", "PO tidak ditemukan");
  const items = await db
    .select()
    .from(purchaseItems)
    .where(eq(purchaseItems.purchaseId, purchaseId))
    .orderBy(purchaseItems.ingredientNameSnapshot);
  return ok({
    id: po.id,
    supplierName: po.supplierName,
    purchaseDate: po.purchaseDate,
    paymentMethod: po.paymentMethod,
    receiptStatus: po.receiptStatus,
    items: items.map((it) => {
      const ordered = parseFloat(it.qtyDecimal ?? "") || it.qty;
      const received = Number(it.receivedQtyDecimal ?? it.receivedQty) || 0;
      return {
        purchaseItemId: it.id,
        ingredientName: it.ingredientNameSnapshot,
        unit: it.unitOverride ?? it.unitSnapshot,
        orderedQty: ordered,
        receivedQty: received,
        remainingQty: Math.max(0, ordered - received),
        unitCost: it.unitCost,
      };
    }),
  });
}

/** Sesi AE-173 — daftar record GR (goods_receipts) untuk tab GR. */
export async function listGoodsReceipts(opts?: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<
  ApiResult<
    Array<{
      id: string;
      receivedDate: string;
      supplierName: string | null;
      poInvoiceNo: string | null;
      poId: string;
      receiptStatus: string;
      totalAmount: number;
      itemCount: number;
    }>
  >
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.goods_receive")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat GR");
  }
  const conds = [eq(goodsReceipts.outletId, session.user.outletId)];
  if (opts?.dateFrom) conds.push(gte(goodsReceipts.receivedDate, opts.dateFrom));
  if (opts?.dateTo) conds.push(lte(goodsReceipts.receivedDate, opts.dateTo));
  /* Sesi AE-177 → AE-177g — sembunyikan GR dari purchase yang DIBATALKAN.
   * Cancel utk PO yang 'ordered' set receiptStatus='cancelled' (cek aman),
   * TAPI cancel utk PO 'received/partial' cuma set status='cancelled' tanpa
   * sentuh receiptStatus → filter receiptStatus saja meleset. Pakai
   * `purchases.status != 'cancelled'` supaya semua jalur cancel ter-cover. */
  conds.push(sql`${purchases.status} != 'cancelled'`);
  const rows = await db
    .select({
      id: goodsReceipts.id,
      receivedDate: goodsReceipts.receivedDate,
      supplierName: suppliers.name,
      poInvoiceNo: purchases.invoiceNo,
      poId: goodsReceipts.purchaseId,
      receiptStatus: purchases.receiptStatus,
      totalAmount: goodsReceipts.totalAmount,
      /* Sesi AE-192 — sda: `${goodsReceipts.id}` polos ke-tangkap
       * goods_receipt_items.id sehingga hitungan bahan selalu 0. */
      itemCount: sql<number>`(
        select count(*)::int from goods_receipt_items gri
        where gri.goods_receipt_id = goods_receipts.id
      )`,
    })
    .from(goodsReceipts)
    .leftJoin(purchases, eq(purchases.id, goodsReceipts.purchaseId))
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(and(...conds))
    .orderBy(desc(goodsReceipts.receivedDate), desc(goodsReceipts.createdAt));
  return ok(rows.map((r) => ({ ...r, receiptStatus: r.receiptStatus ?? "received" })));
}

// ============================================================================
// Hapus GR (Sesi AE-188) — OWNER ONLY
// ============================================================================

/**
 * Hapus satu catatan penerimaan barang (GR) berikut SEMUA efeknya.
 *
 * Diminta owner untuk membersihkan GR percobaan. Sengaja owner-only: satu
 * klik di sini membalik stok, pengeluaran kas, receivedQty PR, status PO,
 * dan jurnalnya sekaligus.
 *
 * Yang dibalik, urut:
 *  1. Stok bahan — hanya untuk movement yang dulu memang menambah stok
 *     (mode perpetual); mode periodic menandai `skipped_stock_update` jadi
 *     tak ada yang perlu dikurangi. Stok jadi negatif → ditolak, karena
 *     artinya barangnya sudah terpakai.
 *  2. Baris `inventory_movements` milik GR ini DIHAPUS, bukan diberi
 *     counter-movement. Alasannya bukan kerapian: `cancelPurchase` membalik
 *     stok dengan menyapu semua movement `kind='purchase'` milik PO lewat
 *     `referenceId`. Kalau baris asli dibiarkan, cancel sesudahnya akan
 *     membalik untuk KEDUA kalinya → stok bocor.
 *  3. `purchase_items.received_qty` dikurangi sebesar yang diterima di GR ini.
 *  4. `purchase_request_items.received_qty` dikurangi (satuan master diambil
 *     dari movement — eksak, tak perlu konversi ulang) + status PR dihitung
 *     ulang.
 *  5. Pengeluaran kas milik GR ini di-soft-delete.
 *  6. Status PO dihitung ulang: ordered / partial / received. Untuk non-TOP
 *     yang tadinya lunas otomatis, status balik ke belum lunas.
 *  7. Jurnal GR dibalik (pair-void `purchase_create_void`).
 *
 * Ditolak: PO batal, hutang TOP yang sudah ditandai lunas (nilai GR sudah
 * dipakai jurnal pelunasan), dan periode akuntansi yang sudah dikunci.
 */
export async function deleteGoodsReceipt(input: {
  id: string;
  reason: string;
}): Promise<
  ApiResult<{
    id: string;
    purchaseId: string;
    receiptStatus: string;
    stockReversed: boolean;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.goods_receipt_delete")) {
    return fail("FORBIDDEN", "Hanya owner yang boleh menghapus GR");
  }
  const reason = (input?.reason ?? "").trim();
  if (!input?.id) return fail("VALIDATION_ERROR", "ID GR tidak valid");
  if (reason.length < 3) {
    return fail("VALIDATION_ERROR", "Alasan hapus minimal 3 karakter");
  }

  let purchaseId = "";
  let receiptStatus: "ordered" | "partial" | "received" = "ordered";
  let stockReversed = false;
  let journalLabel = "";
  let journalDate = "";

  try {
    await db.transaction(async (tx) => {
      const [gr] = await tx
        .select()
        .from(goodsReceipts)
        .where(
          and(
            eq(goodsReceipts.id, input.id),
            eq(goodsReceipts.outletId, session.user.outletId),
          ),
        )
        .limit(1);
      if (!gr) throw new Error("NOT_FOUND");
      purchaseId = gr.purchaseId;
      journalDate = String(gr.receivedDate);

      /* Kunci PO lebih dulu — urutan yang sama dipakai receiveGoods dan
       * updatePurchaseOrder, jadi hapus-vs-terima ter-serialisasi. */
      const [po] = await tx
        .select()
        .from(purchases)
        .where(eq(purchases.id, gr.purchaseId))
        .for("update")
        .limit(1);
      if (!po) throw new Error("NOT_FOUND");
      if (po.status === "cancelled") throw new Error("PURCHASE_CANCELLED");
      if (po.paymentMethod === "top" && po.status === "paid") {
        throw new Error("ALREADY_SETTLED");
      }
      journalLabel = po.invoiceNo ?? `GR ${journalDate}`;

      /* Jurnal GR dibalik dengan entry_date = tanggal terima. Periode yang
       * dikunci membuat pembalikan gagal SETELAH commit (hook fire-and-
       * forget) → stok & kas sudah balik tapi GL tidak. Dicegat di depan. */
      {
        const [year, month] = journalDate.slice(0, 7).split("-").map(Number);
        const [period] = await tx
          .select({ status: accountingPeriods.status })
          .from(accountingPeriods)
          .where(
            and(
              eq(accountingPeriods.outletId, session.user.outletId),
              eq(accountingPeriods.periodYear, year),
              eq(accountingPeriods.periodMonth, month),
            ),
          )
          .limit(1);
        if (period?.status === "locked") {
          throw new Error(`PERIOD_LOCKED:${journalDate.slice(0, 7)}`);
        }
      }

      const grItems = await tx
        .select()
        .from(goodsReceiptItems)
        .where(eq(goodsReceiptItems.goodsReceiptId, gr.id));

      const poItems = await tx
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, po.id));
      const poItemById = new Map(poItems.map((r) => [r.id, r] as const));

      /* masterQty per baris GR, dipakai untuk un-bump PR. Diambil dari
       * movement (sudah dalam satuan master) supaya tidak perlu mengulang
       * konversi — dan tetap benar walau master satuan berubah setelahnya. */
      const masterQtyByPoItem = new Map<string, number>();
      const movementIdsToDrop: string[] = [];

      for (const gi of grItems) {
        const rawQty = Number(gi.receivedQtyDecimal ?? gi.receivedQty);
        let masterQty = rawQty;

        if (gi.movementId) {
          const [mv] = await tx
            .select()
            .from(inventoryMovements)
            .where(eq(inventoryMovements.id, gi.movementId))
            .for("update")
            .limit(1);
          if (mv) {
            const delta = Number(mv.qtyDeltaDecimal ?? mv.qtyDelta);
            if (Number.isFinite(delta) && delta !== 0) masterQty = Math.abs(delta);

            if (!mv.skippedStockUpdate) {
              const [ing] = await tx
                .select()
                .from(ingredients)
                .where(eq(ingredients.id, mv.ingredientId))
                .for("update")
                .limit(1);
              if (ing) {
                const newStock = computeNewStock({
                  currentBigint: ing.currentStock,
                  currentDecimal: ing.currentStockDecimal,
                  delta: -Math.abs(delta),
                });
                if (newStock.bigint < 0) {
                  throw new Error(`NEGATIVE_STOCK:${ing.name}`);
                }
                await tx
                  .update(ingredients)
                  .set({
                    currentStock: newStock.bigint,
                    currentStockDecimal: newStock.decimal,
                    updatedAt: new Date(),
                    updatedBy: session.user.id,
                  })
                  .where(eq(ingredients.id, ing.id));
                stockReversed = true;
              }
            }
            movementIdsToDrop.push(mv.id);
          }
        }

        masterQtyByPoItem.set(
          gi.purchaseItemId,
          (masterQtyByPoItem.get(gi.purchaseItemId) ?? 0) + masterQty,
        );

        // Kurangi received_qty di baris PO.
        const pi = poItemById.get(gi.purchaseItemId);
        if (pi) {
          const current = Number(pi.receivedQtyDecimal ?? pi.receivedQty);
          const next = Math.max(0, current - rawQty);
          await tx
            .update(purchaseItems)
            .set({
              receivedQty: Math.round(next),
              receivedQtyDecimal: next.toFixed(4),
              /* Backlink movement ikut dilepas — barisnya sebentar lagi
               * dihapus, dan FK-nya akan menolak kalau masih menunjuk. */
              movementId: null,
            })
            .where(eq(purchaseItems.id, pi.id));
          poItemById.set(pi.id, {
            ...pi,
            receivedQty: Math.round(next),
            receivedQtyDecimal: next.toFixed(4),
            movementId: null,
          });
        }
      }

      // ---- Un-bump receivedQty PR + hitung ulang status PR ----
      const prLinked = poItems.filter((i) => i.purchaseRequestItemId);
      if (prLinked.length > 0) {
        const prItemIds = prLinked.map((i) => i.purchaseRequestItemId!);
        const prItemRows = await tx
          .select()
          .from(purchaseRequestItems)
          .where(inArray(purchaseRequestItems.id, prItemIds))
          .for("update");
        const prItemMap = new Map(prItemRows.map((r) => [r.id, r] as const));
        const touchedRequestIds = new Set<string>();

        for (const pi of prLinked) {
          const masterQty = masterQtyByPoItem.get(pi.id);
          if (!masterQty || masterQty <= 0) continue;
          const prItem = prItemMap.get(pi.purchaseRequestItemId!);
          if (!prItem) continue;
          const currentDecimal = prItem.receivedQtyDecimal
            ? Number(prItem.receivedQtyDecimal)
            : Number(prItem.receivedQty);
          const next = applyPrReceiveDelta({
            currentDecimal,
            delta: -masterQty,
          });
          await tx
            .update(purchaseRequestItems)
            .set({
              receivedQty: next.receivedQty,
              receivedQtyDecimal: next.receivedQtyDecimal,
              updatedAt: new Date(),
            })
            .where(eq(purchaseRequestItems.id, prItem.id));
          prItemMap.set(prItem.id, {
            ...prItem,
            receivedQty: next.receivedQty,
            receivedQtyDecimal: next.receivedQtyDecimal,
          });
          touchedRequestIds.add(prItem.requestId);
        }

        for (const requestId of touchedRequestIds) {
          const allItems = await tx
            .select()
            .from(purchaseRequestItems)
            .where(eq(purchaseRequestItems.requestId, requestId));
          const newStatus = computePrStatus(
            allItems.map((r) => ({
              requestedQty: Number(r.requestedQty),
              receivedQty: Number(r.receivedQty),
              rejectedAt: r.rejectedAt,
            })),
          );
          const [pr] = await tx
            .select()
            .from(purchaseRequests)
            .where(eq(purchaseRequests.id, requestId))
            .limit(1);
          if (pr && pr.status !== "cancelled" && newStatus !== pr.status) {
            await tx
              .update(purchaseRequests)
              .set({
                status: newStatus,
                completedAt: newStatus === "completed" ? new Date() : null,
                updatedAt: new Date(),
              })
              .where(eq(purchaseRequests.id, requestId));
          }
        }
      }

      // ---- Pengeluaran kas milik GR ini ----
      if (gr.expenseId) {
        await tx
          .update(expenses)
          .set({
            deletedAt: new Date(),
            deletedBy: session.user.id,
            updatedAt: new Date(),
            updatedBy: session.user.id,
          })
          .where(eq(expenses.id, gr.expenseId));
      }

      // ---- Hapus baris GR + movement-nya ----
      await tx
        .delete(goodsReceiptItems)
        .where(eq(goodsReceiptItems.goodsReceiptId, gr.id));
      await tx.delete(goodsReceipts).where(eq(goodsReceipts.id, gr.id));
      if (movementIdsToDrop.length > 0) {
        await tx
          .delete(inventoryMovements)
          .where(inArray(inventoryMovements.id, movementIdsToDrop));
      }

      // ---- Status PO dihitung ulang dari sisa penerimaan ----
      const remaining = Array.from(poItemById.values());
      const anyReceived = remaining.some(
        (pi) => Number(pi.receivedQtyDecimal ?? pi.receivedQty) > 0,
      );
      const fully =
        remaining.length > 0 &&
        remaining.every((pi) => {
          const received = Number(pi.receivedQtyDecimal ?? pi.receivedQty);
          const ordered = parseFloat(pi.qtyDecimal ?? "") || pi.qty;
          return received + 1e-6 >= ordered;
        });
      receiptStatus = fully ? "received" : anyReceived ? "partial" : "ordered";

      /* Expense backlink header menunjuk expense GR terakhir yang masih
       * hidup — kalau yang dihapus adalah itu, dilepas. */
      const [survivingExpense] = await tx
        .select({ id: goodsReceipts.expenseId })
        .from(goodsReceipts)
        .where(
          and(
            eq(goodsReceipts.purchaseId, po.id),
            sql`${goodsReceipts.expenseId} is not null`,
          ),
        )
        .orderBy(desc(goodsReceipts.receivedDate))
        .limit(1);

      const isTop = po.paymentMethod === "top";
      await tx
        .update(purchases)
        .set({
          receiptStatus,
          receivedAt: fully ? po.receivedAt : null,
          /* non-TOP jadi 'paid' otomatis saat diterima penuh — begitu tidak
           * penuh lagi, statusnya harus balik ke belum lunas. */
          status: isTop ? po.status : fully ? "paid" : "pending_payment",
          paidAt: isTop ? po.paidAt : fully ? po.paidAt : null,
          paidBy: isTop ? po.paidBy : fully ? po.paidBy : null,
          expenseId: survivingExpense?.id ?? null,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(purchases.id, po.id));
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return fail("NOT_FOUND", "GR tidak ditemukan");
    if (msg === "PURCHASE_CANCELLED")
      return fail(
        "BAD_STATE",
        "PO-nya sudah dibatalkan — efek GR ini sudah ikut dibalik saat pembatalan.",
      );
    if (msg === "ALREADY_SETTLED")
      return fail(
        "BAD_STATE",
        "Hutang TOP PO ini sudah ditandai lunas. Nilai GR-nya sudah dipakai jurnal pelunasan, jadi GR tidak bisa dihapus.",
      );
    if (msg.startsWith("PERIOD_LOCKED:"))
      return fail(
        "BAD_STATE",
        `GR ini ada di periode ${msg.slice("PERIOD_LOCKED:".length)} yang sudah dikunci — jurnalnya tidak bisa dibalik. Buka periode itu dulu di menu Akuntansi.`,
      );
    if (msg.startsWith("NEGATIVE_STOCK:"))
      return fail(
        "VALIDATION_ERROR",
        `Hapus GR akan bikin stok ${msg.slice("NEGATIVE_STOCK:".length)} negatif — barangnya sudah terpakai untuk penjualan/waste.`,
      );
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "purchases.gr_delete", "Gagal menghapus GR"),
    );
  }

  await logAudit({
    eventType: "purchase.goods_receipt_delete",
    userId: session.user.id,
    entityType: "purchase",
    entityId: purchaseId,
    payload: {
      summary: `Hapus GR ${input.id.slice(0, 8)} — ${reason}`,
      context: {
        goodsReceiptId: input.id,
        reason,
        receiptStatusAfter: receiptStatus,
        stockReversed,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  /* Jurnal GR dibalik. `resyncJournalForGoodsReceipt` dengan total 0 memang
   * berhenti setelah pair-void — persis yang dibutuhkan di sini. */
  {
    const { fireJournalHook, resyncJournalForGoodsReceipt } = await import(
      "@/features/accounting/hooks"
    );
    fireJournalHook(
      () =>
        resyncJournalForGoodsReceipt({
          outletId: session.user.outletId,
          purchaseId,
          goodsReceiptId: input.id,
          purchaseLabel: journalLabel,
          paymentMethod: "cash",
          total: 0,
          lines: [],
          entryDate: journalDate,
          actorId: session.user.id,
        }),
      "purchase_create",
      { sourceId: input.id, outletId: session.user.outletId },
    );
  }

  return ok({ id: input.id, purchaseId, receiptStatus, stockReversed });
}

/** Sesi AE-173 — item-item dari sebuah GR record. */
/* Sesi AE-177 — cross-surface link arah-balik: PO/pembelian yang dibuat dari
 * sebuah PR (via from_purchase_request_id). Dipakai PR detail modal untuk
 * menampilkan "sudah jadi PO #…". */
export async function listPurchasesForPurchaseRequest(prId: string): Promise<
  ApiResult<
    Array<{
      id: string;
      invoiceNo: string | null;
      purchaseDate: string;
      receiptStatus: string;
      status: string;
      totalAmount: number;
      supplierName: string | null;
    }>
  >
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat pembelian");
  }
  const rows = await db
    .select({
      id: purchases.id,
      invoiceNo: purchases.invoiceNo,
      purchaseDate: purchases.purchaseDate,
      receiptStatus: purchases.receiptStatus,
      status: purchases.status,
      totalAmount: purchases.totalAmount,
      supplierName: suppliers.name,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(
      and(
        eq(purchases.outletId, session.user.outletId),
        eq(purchases.fromPurchaseRequestId, prId),
      ),
    )
    .orderBy(desc(purchases.createdAt));
  return ok(rows);
}

export async function fetchGoodsReceiptItems(grId: string): Promise<
  ApiResult<
    Array<{
      ingredientName: string;
      unit: string;
      receivedQty: number;
      unitCost: number;
      totalCost: number;
    }>
  >
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.goods_receive")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat GR");
  }
  // Verify GR belongs to outlet.
  const [gr] = await db
    .select({ id: goodsReceipts.id })
    .from(goodsReceipts)
    .where(
      and(
        eq(goodsReceipts.id, grId),
        eq(goodsReceipts.outletId, session.user.outletId),
      ),
    )
    .limit(1);
  if (!gr) return fail("NOT_FOUND", "GR tidak ditemukan");
  /* Sesi AE-177f — JOIN ke purchase_items untuk ambil unitOverride. GR row
   * sendiri cuma punya unitSnapshot (master); padahal receivedQty disimpan
   * dalam SATUAN YG DIPILIH owner saat purchase (mis. 2 "Pack" Nugget).
   * Pakai `unitOverride ?? unitSnapshot` supaya konsisten dgn tampilan PO
   * (formatPurchaseItemQty). Tanpa join: tampil "2 Pcs" padahal 2 Pack. */
  const rows = await db
    .select({
      ingredientNameSnapshot: goodsReceiptItems.ingredientNameSnapshot,
      unitSnapshot: goodsReceiptItems.unitSnapshot,
      receivedQty: goodsReceiptItems.receivedQty,
      receivedQtyDecimal: goodsReceiptItems.receivedQtyDecimal,
      unitCost: goodsReceiptItems.unitCost,
      totalCost: goodsReceiptItems.totalCost,
      poUnitOverride: purchaseItems.unitOverride,
    })
    .from(goodsReceiptItems)
    .leftJoin(
      purchaseItems,
      eq(goodsReceiptItems.purchaseItemId, purchaseItems.id),
    )
    .where(eq(goodsReceiptItems.goodsReceiptId, grId))
    .orderBy(goodsReceiptItems.ingredientNameSnapshot);
  return ok(
    rows.map((r) => ({
      ingredientName: r.ingredientNameSnapshot,
      unit: r.poUnitOverride ?? r.unitSnapshot,
      receivedQty: Number(r.receivedQtyDecimal ?? r.receivedQty),
      unitCost: r.unitCost,
      totalCost: r.totalCost,
    })),
  );
}

/**
 * Sesi AE-173 — Goods Receipt PARTIAL. Terima qty per-line dari sebuah PO.
 * Bisa terima bertahap: PO 'ordered' → 'partial' → 'received' saat received_qty
 * mencapai qty di semua line. Tiap GR membuat record goods_receipts + gr_items,
 * movement (kind='purchase') per line (stok/WAC kalau perpetual), bump PR
 * receivedQty, dan expense (pengeluaran) untuk total GR ini.
 *
 * `items[].qty` = qty diterima GR INI (increment), dalam satuan RAW line.
 */
export async function receiveGoods(input: {
  purchaseId: string;
  receivedDate?: string;
  items: Array<{ purchaseItemId: string; qty: number }>;
}): Promise<ApiResult<{ goodsReceiptId: string; receiptStatus: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase.goods_receive")) {
    return fail("FORBIDDEN", "Tidak punya hak terima barang");
  }
  if (!input?.purchaseId) return fail("VALIDATION_ERROR", "ID PO tidak valid");
  const recvLines = (input.items ?? []).filter((i) => i.qty > 0);
  if (recvLines.length === 0)
    return fail("VALIDATION_ERROR", "Isi minimal 1 qty diterima");

  const grDate = input.receivedDate ?? toJakartaDateOnly(new Date());
  const recvByItem = new Map<string, number>();
  for (const r of recvLines) {
    recvByItem.set(r.purchaseItemId, (recvByItem.get(r.purchaseItemId) ?? 0) + r.qty);
  }

  let resultGrId = "";
  let resultStatus: "partial" | "received" = "partial";
  try {
    await db.transaction(async (tx) => {
      const [po] = await tx
        .select()
        .from(purchases)
        .where(
          and(
            eq(purchases.id, input.purchaseId),
            eq(purchases.outletId, session.user.outletId),
          ),
        )
        .for("update")
        .limit(1);
      if (!po) throw new Error("NOT_FOUND");
      if (po.receiptStatus !== "ordered" && po.receiptStatus !== "partial")
        throw new Error("BAD_STATE");
      const isTop = po.paymentMethod === "top";

      const poItems = await tx
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, po.id));
      const itemById = new Map(poItems.map((i) => [i.id, i] as const));
      /* Sesi AE-177 — owner: terima boleh LEBIH/KURANG dari pesanan PO
       * (supplier kasih bonus, harga turun, dst). Disparity tercatat di
       * purchase_items.qty (ordered) vs received_qty. */
      for (const [piId] of recvByItem) {
        const pi = itemById.get(piId);
        if (!pi) throw new Error("ITEM_NOT_IN_PO");
      }

      const ingIds = Array.from(new Set(poItems.map((i) => i.ingredientId)));
      const ingRows =
        ingIds.length > 0
          ? await tx
              .select()
              .from(ingredients)
              .where(inArray(ingredients.id, ingIds))
              .for("update")
          : [];
      const ingById = new Map(ingRows.map((r) => [r.id, r] as const));

      const packMap = new Map<string, PackInfo>();
      if (po.supplierId && ingIds.length > 0) {
        const packRows = await tx
          .select({
            ingredientId: supplierIngredients.ingredientId,
            packSize: supplierIngredients.packSize,
            packUnit: supplierIngredients.packUnit,
          })
          .from(supplierIngredients)
          .where(
            and(
              eq(supplierIngredients.outletId, session.user.outletId),
              eq(supplierIngredients.supplierId, po.supplierId),
              inArray(supplierIngredients.ingredientId, ingIds),
              isNull(supplierIngredients.deletedAt),
            ),
          );
        for (const r of packRows) {
          const size = parseFloat(r.packSize);
          if (Number.isFinite(size) && size > 0)
            packMap.set(r.ingredientId, { packSize: size, packUnit: r.packUnit });
        }
      }

      const lastOpname = await fetchLastFinalizedOpname(session.user.outletId);
      const backdateStatus = classifyPurchaseAgainstOpname({
        purchaseDateIso: grDate,
        lastOpnameFinalizedAt: lastOpname?.finalizedAt ?? null,
      });
      const { addOnPurchase } = await getStockMode(session.user.outletId);
      const skipStockEffect =
        shouldSkipStockUpdate(backdateStatus) || !addOnPurchase;

      // Header GR.
      const [gr] = await tx
        .insert(goodsReceipts)
        .values({
          outletId: session.user.outletId,
          purchaseId: po.id,
          receivedDate: grDate,
          createdBy: session.user.id,
        })
        .returning({ id: goodsReceipts.id });
      resultGrId = gr.id;

      let grTotal = 0;
      const prBumpByItem: Array<{ piId: string; masterQty: number }> = [];

      for (const [piId, recvQtyRaw] of recvByItem) {
        const it = itemById.get(piId)!;
        const ing = ingById.get(it.ingredientId);
        if (!ing) continue;

        const existingPacks =
          (ing.packConversions as
            | Array<{ unitLabel: string; qtyPerBase: number }>
            | null) ?? [];
        const tierPacks: Array<{ unitLabel: string; qtyPerBase: number }> = [];
        if (ing.unitBelanja && ing.unitBelanjaPerCogs) {
          const per = parseFloat(ing.unitBelanjaPerCogs);
          if (Number.isFinite(per) && per > 0)
            tierPacks.push({ unitLabel: ing.unitBelanja, qtyPerBase: per });
        }
        if (ing.unitTracking && ing.unitTrackingPerCogs) {
          const per = parseFloat(ing.unitTrackingPerCogs);
          if (Number.isFinite(per) && per > 0)
            tierPacks.push({ unitLabel: ing.unitTracking, qtyPerBase: per });
        }
        const mergedPacks = mergePackConversions(existingPacks, tierPacks);

        const conv = convertPurchaseQty({
          qty: recvQtyRaw,
          fromUnit: it.unitOverride ?? it.unitSnapshot ?? ing.unit,
          masterUnit: ing.unit,
          pack: packMap.get(it.ingredientId) ?? null,
          ingredientPacks: mergedPacks,
        });
        if (!conv.ok) throw new Error(`UNIT_ERROR:${ing.name}:${conv.message}`);

        const qtyMaster = conv.qtyMaster;
        const unitCostMaster = Math.max(0, Math.round(it.unitCost / conv.costFactor));
        const totalCostMaster = Math.round(qtyMaster * unitCostMaster);
        // Nilai GR pakai RAW (sama dgn nota): recvQtyRaw × unitCost line.
        const lineTotalRaw = Math.round(recvQtyRaw * it.unitCost);
        grTotal += lineTotalRaw;
        const movementDelta = formatMovementDelta(qtyMaster);

        if (!skipStockEffect) {
          const newStock = computeNewStock({
            currentBigint: ing.currentStock,
            currentDecimal: ing.currentStockDecimal,
            delta: qtyMaster,
          });
          const oldCostBefore = ing.costPerUnit;
          const wac = computeNewWac({
            oldQty: Number(ing.currentStockDecimal ?? 0),
            oldCost: oldCostBefore,
            purchaseQty: qtyMaster,
            purchaseTotal: totalCostMaster,
          });
          const newWacCost = wac.newCost;
          const costChanged = newWacCost !== oldCostBefore;
          const updateValues: Record<string, unknown> = {
            currentStock: newStock.bigint,
            currentStockDecimal: newStock.decimal,
            costPerUnit: newWacCost,
            updatedAt: new Date(),
            updatedBy: session.user.id,
          };
          if (costChanged) updateValues.costLastChangedAt = new Date();
          await tx
            .update(ingredients)
            .set(updateValues)
            .where(eq(ingredients.id, it.ingredientId));
          ingById.set(it.ingredientId, {
            ...ing,
            currentStock: newStock.bigint,
            currentStockDecimal: newStock.decimal,
            costPerUnit: newWacCost,
          });
          if (costChanged) {
            await tx.insert(ingredientCostHistory).values({
              outletId: session.user.outletId,
              ingredientId: it.ingredientId,
              oldCostPerUnit: oldCostBefore,
              newCostPerUnit: newWacCost,
              triggerType: "purchase_wac",
              triggerRefType: "purchase",
              triggerRefId: po.id,
              changedQty: qtyMaster.toFixed(4),
              changedValue: totalCostMaster,
              actorId: session.user.id,
              notes: `GR ${po.invoiceNo ?? po.id.slice(0, 8)}`,
            });
            try {
              await cascadeCostUpdate(
                tx,
                session.user.outletId,
                it.ingredientId,
                session.user.id,
              );
            } catch {
              // fail-soft
            }
          }
        }

        const [movement] = await tx
          .insert(inventoryMovements)
          .values({
            outletId: session.user.outletId,
            ingredientId: it.ingredientId,
            kind: "purchase",
            qtyDelta: movementDelta.bigint,
            qtyDeltaDecimal: movementDelta.decimal,
            unitCostAtMovement: unitCostMaster,
            referenceType: "manual",
            referenceId: po.id,
            reason: `GR ${po.invoiceNo ?? po.id.slice(0, 8)}${
              skipStockEffect ? " (no stock add)" : ""
            }`,
            skippedStockUpdate: skipStockEffect,
            createdBy: session.user.id,
          })
          .returning({ id: inventoryMovements.id });

        await tx.insert(goodsReceiptItems).values({
          goodsReceiptId: gr.id,
          purchaseItemId: it.id,
          ingredientId: it.ingredientId,
          receivedQty: Math.max(1, Math.round(recvQtyRaw)),
          receivedQtyDecimal: recvQtyRaw.toFixed(4),
          unitCost: it.unitCost,
          totalCost: lineTotalRaw,
          movementId: movement.id,
          ingredientNameSnapshot: it.ingredientNameSnapshot,
          unitSnapshot: it.unitSnapshot,
          sectionSnapshot: it.sectionSnapshot,
        });

        // Akumulasi received_qty di purchase_items.
        const newReceived =
          Number(it.receivedQtyDecimal ?? it.receivedQty) + recvQtyRaw;
        await tx
          .update(purchaseItems)
          .set({
            receivedQty: Math.round(newReceived),
            receivedQtyDecimal: newReceived.toFixed(4),
            movementId: movement.id,
          })
          .where(eq(purchaseItems.id, it.id));
        itemById.set(it.id, {
          ...it,
          receivedQty: Math.round(newReceived),
          receivedQtyDecimal: newReceived.toFixed(4),
        });
        prBumpByItem.push({ piId: it.id, masterQty: qtyMaster });
      }

      // PR receivedQty bump (per received increment).
      const prItemIds = poItems
        .map((i) => i.purchaseRequestItemId)
        .filter((id): id is string => Boolean(id));
      if (prItemIds.length > 0) {
        const prItemRows = await tx
          .select()
          .from(purchaseRequestItems)
          .where(inArray(purchaseRequestItems.id, prItemIds))
          .for("update");
        const prItemMap = new Map(prItemRows.map((r) => [r.id, r] as const));
        const requestIds = Array.from(new Set(prItemRows.map((r) => r.requestId)));
        for (const bump of prBumpByItem) {
          const pi = itemById.get(bump.piId);
          if (!pi?.purchaseRequestItemId) continue;
          const prItem = prItemMap.get(pi.purchaseRequestItemId);
          if (!prItem) continue;
          const addQty = Math.max(1, Math.round(bump.masterQty));
          const newReceivedQty = Number(prItem.receivedQty) + addQty;
          const newDecimal = (
            (prItem.receivedQtyDecimal ? Number(prItem.receivedQtyDecimal) : 0) +
            bump.masterQty
          ).toFixed(4);
          await tx
            .update(purchaseRequestItems)
            .set({ receivedQty: newReceivedQty, receivedQtyDecimal: newDecimal, updatedAt: new Date() })
            .where(eq(purchaseRequestItems.id, prItem.id));
          prItemMap.set(prItem.id, {
            ...prItem,
            receivedQty: newReceivedQty,
            receivedQtyDecimal: newDecimal,
          });
        }
        for (const requestId of requestIds) {
          const allItems = await tx
            .select()
            .from(purchaseRequestItems)
            .where(eq(purchaseRequestItems.requestId, requestId));
          const newStatus = computePrStatus(
            allItems.map((r) => ({
              requestedQty: Number(r.requestedQty),
              receivedQty: Number(r.receivedQty),
              rejectedAt: r.rejectedAt,
            })),
          );
          const [pr] = await tx
            .select()
            .from(purchaseRequests)
            .where(eq(purchaseRequests.id, requestId))
            .limit(1);
          const updates: Record<string, unknown> = { updatedAt: new Date() };
          if (pr && newStatus !== pr.status && newStatus !== "cancelled") {
            updates.status = newStatus;
            if (newStatus === "completed") updates.completedAt = new Date();
          }
          await tx
            .update(purchaseRequests)
            .set(updates)
            .where(eq(purchaseRequests.id, requestId));
        }
      }

      // Expense untuk GR ini (non-TOP).
      let expenseId: string | null = null;
      if (!isTop && grTotal > 0) {
        const [defaultCat] = await tx
          .select()
          .from(expenseCategories)
          .where(
            and(
              eq(expenseCategories.outletId, session.user.outletId),
              isNull(expenseCategories.deletedAt),
            ),
          )
          .orderBy(asc(expenseCategories.displayOrder))
          .limit(1);
        if (defaultCat) {
          const [exp] = await tx
            .insert(expenses)
            .values({
              outletId: session.user.outletId,
              expenseDate: grDate,
              categoryId: defaultCat.id,
              description: `Belanja ${paymentMethodLabel(po.paymentMethod)} — ${buildPurchaseLabel(
                {
                  supplierName: await resolveSupplierName(po.supplierId),
                  invoiceNo: po.invoiceNo,
                  receiptDate: grDate,
                },
              )}`,
              amount: grTotal,
              paymentMethod: expensePaymentMethod(po.paymentMethod),
              sourceType: "purchase",
              purchaseId: po.id,
              createdBy: session.user.id,
            })
            .returning({ id: expenses.id });
          expenseId = exp.id;
        }
      }
      await tx
        .update(goodsReceipts)
        .set({ totalAmount: grTotal, expenseId })
        .where(eq(goodsReceipts.id, gr.id));

      // Status PO: fully received kalau SEMUA line received >= ordered.
      const fully = poItems.every((pi) => {
        const cur = itemById.get(pi.id)!;
        const received = Number(cur.receivedQtyDecimal ?? cur.receivedQty);
        const ordered = parseFloat(pi.qtyDecimal ?? "") || pi.qty;
        return received + 1e-6 >= ordered;
      });
      resultStatus = fully ? "received" : "partial";
      await tx
        .update(purchases)
        .set({
          receiptStatus: resultStatus,
          receivedAt: fully ? new Date() : po.receivedAt,
          status: fully ? (isTop ? "pending_payment" : "paid") : po.status,
          paidAt: fully && !isTop ? new Date() : po.paidAt,
          paidBy: fully && !isTop ? session.user.id : po.paidBy,
          expenseId: expenseId ?? po.expenseId,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(purchases.id, po.id));
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return fail("NOT_FOUND", "PO tidak ditemukan");
    if (msg === "BAD_STATE")
      return fail("BAD_STATE", "PO sudah diterima penuh / dibatalkan");
    if (msg === "ITEM_NOT_IN_PO")
      return fail("VALIDATION_ERROR", "Ada item yang bukan bagian PO ini");
    if (msg.startsWith("UNIT_ERROR:")) {
      const rest = msg.slice("UNIT_ERROR:".length);
      const sep = rest.indexOf(":");
      const ingName = sep > 0 ? rest.slice(0, sep) : "?";
      const userMsg = sep > 0 ? rest.slice(sep + 1) : rest;
      return fail("VALIDATION_ERROR", `Bahan "${ingName}": ${userMsg}`);
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "purchases.receive_goods", "Gagal terima barang"),
    );
  }

  await logAudit({
    eventType: "purchase.goods_receive",
    userId: session.user.id,
    entityType: "purchase",
    entityId: input.purchaseId,
    payload: {
      summary: `GR ${resultGrId.slice(0, 8)} — PO ${input.purchaseId.slice(0, 8)} (${grDate}, ${resultStatus})`,
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  // Jurnal akuntansi (post-commit) — section lines dari gr_items GR ini.
  {
    const items = await db
      .select({
        section: goodsReceiptItems.sectionSnapshot,
        totalCost: goodsReceiptItems.totalCost,
      })
      .from(goodsReceiptItems)
      .where(eq(goodsReceiptItems.goodsReceiptId, resultGrId));
    const bySection = new Map<string, number>();
    for (const it of items) {
      const key = it.section ?? "null";
      bySection.set(key, (bySection.get(key) ?? 0) + Number(it.totalCost));
    }
    const sectionLines = Array.from(bySection.entries()).map(([key, amount]) => ({
      section: (key === "null" ? null : key) as
        | "kitchen"
        | "bar"
        | "supporting"
        | "cleaning"
        | null,
      amount,
    }));
    const total = sectionLines.reduce((s, l) => s + l.amount, 0);
    if (total > 0) {
      const [poRow] = await db
        .select()
        .from(purchases)
        .where(eq(purchases.id, input.purchaseId))
        .limit(1);
      if (poRow) {
        const { fireJournalHook, postJournalForPurchaseCreate } = await import(
          "@/features/accounting/hooks"
        );
        fireJournalHook(
          async () =>
            postJournalForPurchaseCreate({
              outletId: session.user.outletId,
              purchaseId: input.purchaseId,
              purchaseLabel: await resolvePurchaseLabel(input.purchaseId, {
                receiptDate: grDate,
              }),
              paymentMethod: poRow.paymentMethod,
              total,
              lines: sectionLines,
              entryDate: grDate,
              actorId: session.user.id,
              /* Sesi AE-177h — sourceId = goodsReceiptId supaya partial GR
               * ke-2/3 tidak hit idempotency (sebelumnya sourceId=purchaseId
               * → kedua GR partial silent skip → GL kurang catat). */
              sourceId: resultGrId,
            }),
          "purchase_create",
        );
      }
    }
  }

  return ok({ goodsReceiptId: resultGrId, receiptStatus: resultStatus });
}
