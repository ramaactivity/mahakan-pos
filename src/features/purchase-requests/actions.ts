"use server";

import { and, desc, eq, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  purchaseItems,
  purchaseRequestItems,
  purchaseRequests,
  purchases,
  shifts,
  supplierIngredients,
  suppliers,
  users,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { displayUnit } from "@/lib/unit-conversion";
import {
  fail,
  ok,
  type ApiResult,
  type CancelPurchaseRequestInput,
  type CreatePurchaseRequestInput,
  type LowStockIngredient,
  type PrForPurchase,
  type PrItemForPurchase,
  type PurchaseRequest,
  type PurchaseRequestStatus,
  type PurchaseRequestWithItems,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/**
 * Sesi AE-15 — PR dashboard stats untuk backoffice management view.
 * Mengembalikan counts per status + aging open PRs (>3 hari unfulfilled)
 * + monthly completion summary.
 */
export interface PurchaseRequestStats {
  openCount: number;
  partialCount: number;
  completedCount: number;
  cancelledCount: number;
  /** PR dengan status open yang sudah > 3 hari (perlu attention). */
  agingOpenCount: number;
  /** PR completed bulan kalender ini. */
  completedThisMonth: number;
  /** Jumlah ITEM belum diproses (received == 0, belum ditolak, belum ditarik
   *  ke PO aktif) di PR open/partial. Sesi AE-177 — hitung item, bukan jumlah
   *  qty lintas satuan. Feedback Cacil 2026-06-12 — selaras categorizePrItem. */
  pendingItemCount: number;
}

export async function getPurchaseRequestStats(): Promise<
  ApiResult<PurchaseRequestStats>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase_request.view")) {
    return fail("FORBIDDEN", "Tidak punya hak akses");
  }
  const outletId = session.user.outletId;

  // Status counts.
  const statusRows = await db
    .select({
      status: purchaseRequests.status,
      count: sql<string>`count(*)::int`,
    })
    .from(purchaseRequests)
    .where(
      and(
        eq(purchaseRequests.outletId, outletId),
        isNull(purchaseRequests.deletedAt),
      ),
    )
    .groupBy(purchaseRequests.status);

  const counts = {
    open: 0,
    partial: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const r of statusRows) {
    const k = r.status as keyof typeof counts;
    if (k in counts) counts[k] = Number(r.count);
  }

  // Aging open PRs (created > 3 days ago, still open).
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const [agingRow] = await db
    .select({ count: sql<string>`count(*)::int` })
    .from(purchaseRequests)
    .where(
      and(
        eq(purchaseRequests.outletId, outletId),
        eq(purchaseRequests.status, "open"),
        isNull(purchaseRequests.deletedAt),
        lte(purchaseRequests.createdAt, threeDaysAgo),
      ),
    );

  // Completed bulan ini (calendar month based on completedAt).
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [monthRow] = await db
    .select({ count: sql<string>`count(*)::int` })
    .from(purchaseRequests)
    .where(
      and(
        eq(purchaseRequests.outletId, outletId),
        eq(purchaseRequests.status, "completed"),
        isNull(purchaseRequests.deletedAt),
        sql`${purchaseRequests.completedAt} >= ${monthStart}`,
      ),
    );

  /* Sesi AE-177 — HITUNG ITEM (bukan jumlah qty lintas satuan, yg dulu bikin
   * angka tak bermakna gr+Btl+L dijumlah).
   * Feedback Cacil 2026-06-12 — definisi selaras categorizePrItem: item
   * "belum dibeli" = receivedQty == 0 (under-buy = keputusan final owner,
   * bukan pending) DAN belum ditolak DAN belum ditarik ke PO aktif.
   * 2 query terpisah (bukan correlated NOT EXISTS) — hindari pitfall
   * Drizzle: kolom senama (received_qty ada di purchase_items juga). */
  const pendingCandidates = await db
    .select({ id: purchaseRequestItems.id })
    .from(purchaseRequestItems)
    .innerJoin(
      purchaseRequests,
      eq(purchaseRequests.id, purchaseRequestItems.requestId),
    )
    .where(
      and(
        eq(purchaseRequests.outletId, outletId),
        isNull(purchaseRequests.deletedAt),
        inArray(purchaseRequests.status, ["open", "partial"]),
        eq(purchaseRequestItems.receivedQty, 0),
        isNull(purchaseRequestItems.rejectedAt),
      ),
    );
  const pendingLinked = await fetchActivePurchaseLinkIds(
    pendingCandidates.map((r) => r.id),
  );
  const pendingItemCount = pendingCandidates.length - pendingLinked.size;

  return ok({
    openCount: counts.open,
    partialCount: counts.partial,
    completedCount: counts.completed,
    cancelledCount: counts.cancelled,
    agingOpenCount: Number(agingRow?.count ?? 0),
    completedThisMonth: Number(monthRow?.count ?? 0),
    pendingItemCount,
  });
}

/**
 * Suggested qty pattern: reorderThreshold * 1.5 - currentStock, clamped
 * minimum to reorderThreshold so under-stocked items at least get re-stocked
 * to threshold. Floor minimum 1 (bigint can't be 0 for requested_qty).
 */
function suggestQty(currentStock: number, reorderThreshold: number): number {
  const target = Math.max(Math.ceil(reorderThreshold * 1.5), reorderThreshold);
  const needed = target - currentStock;
  return Math.max(needed, 1);
}

/**
 * List ingredients dengan currentStock <= reorderThreshold, untuk auto-prefill
 * form belanja saat tutup shift.
 */
export async function listLowStockIngredients(): Promise<
  ApiResult<LowStockIngredient[]>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase_request.create")) {
    return fail("FORBIDDEN", "Tidak punya hak akses");
  }

  const rows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      section: ingredients.section,
      currentStock: ingredients.currentStock,
      reorderThreshold: ingredients.reorderThreshold,
      packConversions: ingredients.packConversions,
      unitBelanja: ingredients.unitBelanja,
      unitBelanjaPerCogs: ingredients.unitBelanjaPerCogs,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, session.user.outletId),
        eq(ingredients.isActive, true),
        isNull(ingredients.deletedAt),
        isNotNull(ingredients.reorderThreshold),
        lte(ingredients.currentStock, ingredients.reorderThreshold),
      ),
    )
    .orderBy(ingredients.section, ingredients.name);

  const result: LowStockIngredient[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    section: r.section,
    currentStock: Number(r.currentStock),
    reorderThreshold: Number(r.reorderThreshold ?? 0),
    suggestedQty: suggestQty(
      Number(r.currentStock),
      Number(r.reorderThreshold ?? 0),
    ),
    packConversions: Array.isArray(r.packConversions)
      ? (r.packConversions as Array<{ unitLabel: string; qtyPerBase: number }>)
      : [],
    unitBelanja: r.unitBelanja,
    unitBelanjaPerCogs: r.unitBelanjaPerCogs,
  }));

  return ok(result);
}

export async function createPurchaseRequest(
  input: CreatePurchaseRequestInput,
): Promise<ApiResult<{ id: string; itemCount: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase_request.create")) {
    return fail("FORBIDDEN", "Tidak punya hak buat permintaan belanja");
  }
  if (!input.items || input.items.length === 0) {
    return fail("EMPTY_ITEMS", "Minimal 1 item harus diisi");
  }
  // Sesi AE-16 — support manual items (ingredientId null). Each item
  // need EITHER ingredientId (linked) OR name+unit (manual). Reject kalau
  // dua-duanya kosong.
  for (const item of input.items) {
    const hasLink = Boolean(item.ingredientId);
    const hasManual = Boolean(
      item.ingredientNameSnapshot && item.ingredientNameSnapshot.trim() &&
        item.unitSnapshot && item.unitSnapshot.trim(),
    );
    if (!hasLink && !hasManual) {
      return fail(
        "MISSING_ITEM_INFO",
        "Item harus pilih bahan atau isi nama + satuan manual",
      );
    }
    if (!Number.isFinite(item.requestedQty) || item.requestedQty <= 0) {
      return fail("INVALID_QTY", "Qty harus > 0");
    }
  }

  // Snapshot ingredients untuk linked items only (manual pakai input string).
  const linkedIds = input.items
    .map((i) => i.ingredientId)
    .filter((x): x is string => Boolean(x));
  const ingredientRows =
    linkedIds.length > 0
      ? await db
          .select({
            id: ingredients.id,
            name: ingredients.name,
            unit: ingredients.unit,
            outletId: ingredients.outletId,
          })
          .from(ingredients)
          .where(inArray(ingredients.id, linkedIds))
      : [];

  const byId = new Map(ingredientRows.map((r) => [r.id, r]));
  for (const item of input.items) {
    if (!item.ingredientId) continue; // manual — skip ingredient validation
    const ing = byId.get(item.ingredientId);
    if (!ing) return fail("INGREDIENT_NOT_FOUND", "Bahan tidak ditemukan");
    if (ing.outletId !== session.user.outletId) {
      return fail("CROSS_OUTLET", "Bahan dari outlet lain");
    }
  }

  const result = await db.transaction(async (tx) => {
    const [request] = await tx
      .insert(purchaseRequests)
      .values({
        outletId: session.user.outletId,
        shiftId: input.shiftId ?? null,
        status: "open",
        notes: input.notes ?? null,
        createdBy: session.user.id,
      })
      .returning({ id: purchaseRequests.id });

    let order = 0;
    for (const item of input.items) {
      // Linked: pakai master snapshot. Manual: pakai input.
      const ing = item.ingredientId ? byId.get(item.ingredientId) : null;
      const nameSnapshot = ing
        ? ing.name
        : (item.ingredientNameSnapshot ?? "").trim();
      /* Sesi AE-176 — satuan PR disimpan KANONIK (displayUnit) + LIVE master
       * untuk item linked. Konsisten dgn Kelola Bahan/Opname/Market List. */
      const unitSnapshot = displayUnit(
        ing ? ing.unit : (item.unitSnapshot ?? "").trim(),
      );
      // Sesi AE-16 — qty decimal mirror.
      const qtyBigint = Math.max(1, Math.floor(item.requestedQty));
      const qtyDecimal = item.requestedQty.toFixed(4);
      await tx.insert(purchaseRequestItems).values({
        requestId: request.id,
        ingredientId: ing ? ing.id : null,
        ingredientNameSnapshot: nameSnapshot,
        unitSnapshot,
        requestedQty: qtyBigint,
        requestedQtyDecimal: qtyDecimal,
        receivedQty: 0,
        receivedQtyDecimal: "0.0000",
        notes: item.notes ?? null,
        displayOrder: order++,
      });
    }

    return { id: request.id, itemCount: input.items.length };
  });

  await logAudit({
    eventType: "purchase_request.create",
    userId: session.user.id,
    entityType: "purchase_request",
    entityId: result.id,
    payload: {
      summary: `Permintaan belanja dibuat dengan ${result.itemCount} item`,
      after: {
        shiftId: input.shiftId ?? null,
        itemCount: result.itemCount,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit purchase_request.create]", e));

  /* Sesi AE-124 — push notif ke user yang subscribed kategori "inventory"
   * di outlet (default: Cacil, plus Rama+Sekal). Honor quiet hours + snooze.
   * Fire-and-forget. */
  void (async () => {
    try {
      const { sendCategorizedPush } = await import(
        "@/features/push-notifications/server"
      );
      await sendCategorizedPush(
        "inventory",
        session.user.outletId,
        {
          title: "Permintaan belanja baru",
          body: `${session.user.name} request ${result.itemCount} item${input.notes ? ` · ${input.notes.slice(0, 60)}` : ""}`,
          url: "/dashboard#purchase_requests",
          tag: `pr-new-${result.id.slice(0, 8)}`,
        },
      );
    } catch (e) {
      console.error("[push] purchase_request.create notif fail:", e);
    }
  })();

  return ok(result);
}

/**
 * Feedback Cacil 2026-06-12 — PR item dianggap "sudah ditarik ke pembelian"
 * kalau punya baris purchase_items yang parent purchase-nya belum dibatalkan
 * (status != 'cancelled' — konsisten filter COGS/GR sesi AE-177g). Dipakai
 * untuk menyembunyikan item itu dari daftar outstanding + Tarik ke Pembelian
 * walau barangnya belum diterima (PO ordered, GR belum) → cegah dobel-tarik.
 */
async function fetchActivePurchaseLinkIds(
  itemIds: string[],
): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ prItemId: purchaseItems.purchaseRequestItemId })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
    .where(
      and(
        inArray(purchaseItems.purchaseRequestItemId, itemIds),
        ne(purchases.status, "cancelled"),
      ),
    );
  const set = new Set<string>();
  for (const r of rows) if (r.prItemId) set.add(r.prItemId);
  return set;
}

export interface ListPurchaseRequestsOptions {
  status?: PurchaseRequestStatus | "all";
  /** Default 50. */
  limit?: number;
}

export async function listPurchaseRequests(
  opts: ListPurchaseRequestsOptions & {
    /** Sesi AE-15 — kalau true, filter ke `createdBy = session.user.id`
     * sehingga staff bisa lihat PR mereka sendiri tanpa butuh
     * `purchase_request.view` permission. Backoffice tetap pakai default
     * (false) untuk lihat semua PR di outlet. */
    onlyMine?: boolean;
  } = {},
): Promise<ApiResult<PurchaseRequestWithItems[]>> {
  const session = await requireSession();
  // Staff can list their own PRs (createdBy = self), tapi backoffice list
  // semua PR di outlet butuh `purchase_request.view`.
  if (
    !opts.onlyMine &&
    !hasPermission(session.user.role, "purchase_request.view")
  ) {
    return fail("FORBIDDEN", "Tidak punya hak akses");
  }
  // Even with onlyMine, harus punya create permission (sanity gate).
  if (
    opts.onlyMine &&
    !hasPermission(session.user.role, "purchase_request.create")
  ) {
    return fail("FORBIDDEN", "Tidak punya hak akses");
  }

  const limit = opts.limit ?? 50;
  const conds = [
    eq(purchaseRequests.outletId, session.user.outletId),
    isNull(purchaseRequests.deletedAt),
  ];
  if (opts.status && opts.status !== "all") {
    conds.push(eq(purchaseRequests.status, opts.status));
  }
  if (opts.onlyMine) {
    conds.push(eq(purchaseRequests.createdBy, session.user.id));
  }

  const requestRows = await db
    .select({
      request: purchaseRequests,
      createdByName: users.name,
      shiftStartedAt: shifts.openedAt,
    })
    .from(purchaseRequests)
    .leftJoin(users, eq(users.id, purchaseRequests.createdBy))
    .leftJoin(shifts, eq(shifts.id, purchaseRequests.shiftId))
    .where(and(...conds))
    .orderBy(desc(purchaseRequests.createdAt))
    .limit(limit);

  if (requestRows.length === 0) return ok([]);

  const requestIds = requestRows.map((r) => r.request.id);
  const itemRows = await db
    .select()
    .from(purchaseRequestItems)
    .where(inArray(purchaseRequestItems.requestId, requestIds))
    .orderBy(purchaseRequestItems.requestId, purchaseRequestItems.displayOrder);

  // Feedback Cacil 2026-06-12 — tandai item yang sudah ditarik ke pembelian/PO
  // aktif supaya UI bisa memisahkan "dalam PO (menunggu diterima)" dari
  // "belum diproses".
  const activeLinkIds = await fetchActivePurchaseLinkIds(
    itemRows.map((i) => i.id),
  );

  const byRequestId = new Map<
    string,
    Array<(typeof itemRows)[number] & { inActivePurchase: boolean }>
  >();
  for (const it of itemRows) {
    if (!byRequestId.has(it.requestId)) byRequestId.set(it.requestId, []);
    byRequestId
      .get(it.requestId)!
      .push({ ...it, inActivePurchase: activeLinkIds.has(it.id) });
  }

  // Fetch cancelledBy names lazily kalau ada.
  const cancelledByIds = requestRows
    .map((r) => r.request.cancelledBy)
    .filter((x): x is string => Boolean(x));
  const cancelledByNames = new Map<string, string>();
  if (cancelledByIds.length > 0) {
    const rows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, cancelledByIds));
    rows.forEach((r) => cancelledByNames.set(r.id, r.name));
  }

  const result: PurchaseRequestWithItems[] = requestRows.map((r) => ({
    ...r.request,
    items: byRequestId.get(r.request.id) ?? [],
    createdByName: r.createdByName,
    cancelledByName: r.request.cancelledBy
      ? cancelledByNames.get(r.request.cancelledBy) ?? null
      : null,
    shiftStartedAt: r.shiftStartedAt,
  }));

  return ok(result);
}

/**
 * Sesi AE-19 — Reject single item dari PR (tanpa cancel whole PR).
 * Owner/manager pakai ini kalau supplier ga punya stok untuk item
 * specific, atau item ga jadi dibutuhin. Rejected items exclude dari
 * fulfillment calc — parent status auto-recompute.
 *
 * Idempotent: kalau item already rejected, return ok (no-op). Kalau
 * mau un-reject, sediain `unrejectItem` action separate (defer).
 */
export async function rejectItem(input: {
  itemId: string;
  reason: string;
}): Promise<
  ApiResult<{
    requestId: string;
    newStatus: PurchaseRequestStatus;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase_request.receive")) {
    return fail("FORBIDDEN", "Tidak punya hak reject item");
  }
  const reason = input.reason.trim();
  if (reason.length < 3) {
    return fail("INVALID_REASON", "Alasan minimal 3 karakter");
  }

  type RejectErr =
    | "ITEM_NOT_FOUND"
    | "REQUEST_NOT_FOUND"
    | "CROSS_OUTLET"
    | "REQUEST_CANCELLED"
    | "ITEM_ALREADY_BOUGHT"
    | "ITEM_IN_ACTIVE_PO";
  type RejectResult =
    | { error: RejectErr }
    | { requestId: string; newStatus: PurchaseRequestStatus };

  const result: RejectResult = await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.id, input.itemId))
      .limit(1);
    if (!item) return { error: "ITEM_NOT_FOUND" };

    const [parent] = await tx
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, item.requestId))
      .limit(1);
    if (!parent) return { error: "REQUEST_NOT_FOUND" };
    if (parent.outletId !== session.user.outletId) {
      return { error: "CROSS_OUTLET" };
    }
    if (parent.status === "cancelled") {
      return { error: "REQUEST_CANCELLED" };
    }

    // Idempotent — kalau already rejected, just return current status.
    if (item.rejectedAt) {
      return { requestId: parent.id, newStatus: parent.status };
    }

    /* Feedback Cacil 2026-06-12 (audit lanjutan) — guard server. Tombol Tolak
     * di UI sudah hanya muncul utk item outstanding, tapi tab basi/race masih
     * bisa nembak action ini utk item yang sudah dibeli / sedang dalam PO
     * aktif. Tolak di sini supaya bucket tetap konsisten. */
    if (Number(item.receivedQty) > 0) {
      return { error: "ITEM_ALREADY_BOUGHT" };
    }
    const activeLink = await tx
      .select({ id: purchaseItems.id })
      .from(purchaseItems)
      .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
      .where(
        and(
          eq(purchaseItems.purchaseRequestItemId, item.id),
          ne(purchases.status, "cancelled"),
        ),
      )
      .limit(1);
    if (activeLink.length > 0) {
      return { error: "ITEM_IN_ACTIVE_PO" };
    }

    await tx
      .update(purchaseRequestItems)
      .set({
        rejectedAt: new Date(),
        rejectedBy: session.user.id,
        rejectReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(purchaseRequestItems.id, input.itemId));

    // Recompute parent status excluding rejected items dari "yang harus
    // di-fulfill". Logic: untuk active items only:
    //   all received >= requested → completed
    //   any > 0 → partial
    //   else → open
    // Kalau SEMUA items rejected, parent jadi cancelled (no work to do).
    const allItems = await tx
      .select({
        requestedQty: purchaseRequestItems.requestedQty,
        receivedQty: purchaseRequestItems.receivedQty,
        rejectedAt: purchaseRequestItems.rejectedAt,
      })
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.requestId, parent.id));

    const active = allItems.filter((i) => i.rejectedAt === null);
    const allRejected = allItems.length > 0 && active.length === 0;

    let newStatus: PurchaseRequestStatus = "open";
    if (allRejected) {
      newStatus = "cancelled";
    } else {
      const totalReq = active.reduce((s, i) => s + Number(i.requestedQty), 0);
      const totalRecv = active.reduce((s, i) => s + Number(i.receivedQty), 0);
      if (totalReq > 0 && totalRecv >= totalReq) newStatus = "completed";
      else if (totalRecv > 0) newStatus = "partial";
    }

    if (newStatus !== parent.status) {
      await tx
        .update(purchaseRequests)
        .set({
          status: newStatus,
          completedAt: newStatus === "completed" ? new Date() : null,
          cancelledAt: newStatus === "cancelled" ? new Date() : null,
          cancelledBy: newStatus === "cancelled" ? session.user.id : null,
          cancelReason:
            newStatus === "cancelled"
              ? "Semua item di-reject — auto-cancel"
              : null,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(purchaseRequests.id, parent.id));
    } else {
      await tx
        .update(purchaseRequests)
        .set({ updatedAt: new Date(), updatedBy: session.user.id })
        .where(eq(purchaseRequests.id, parent.id));
    }

    return { requestId: parent.id, newStatus };
  });

  if ("error" in result) {
    const messages: Record<RejectErr, string> = {
      ITEM_NOT_FOUND: "Item tidak ditemukan",
      REQUEST_NOT_FOUND: "Request tidak ditemukan",
      CROSS_OUTLET: "Request dari outlet lain",
      REQUEST_CANCELLED: "Request sudah dibatalkan",
      ITEM_ALREADY_BOUGHT:
        "Item sudah dibeli — tidak bisa ditolak. Refresh halaman untuk lihat status terbaru.",
      ITEM_IN_ACTIVE_PO:
        "Item sedang dalam PO aktif (menunggu diterima). Batalkan PO-nya dulu kalau memang tidak jadi.",
    };
    return fail(result.error, messages[result.error]);
  }

  await logAudit({
    eventType: "purchase_request.receive",
    userId: session.user.id,
    entityType: "purchase_request_item",
    entityId: input.itemId,
    payload: {
      summary: `Item di-reject: ${reason}`,
      after: { rejectedAt: new Date(), reason, requestStatus: result.newStatus },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit purchase_request.reject_item]", e));

  return ok(result);
}

export async function cancelPurchaseRequest(
  input: CancelPurchaseRequestInput,
): Promise<ApiResult<PurchaseRequest>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase_request.cancel")) {
    return fail("FORBIDDEN", "Tidak punya hak batalkan");
  }
  const reason = (input.reason ?? "").trim();
  if (reason.length === 0) return fail("REASON_REQUIRED", "Alasan wajib diisi");

  const [existing] = await db
    .select()
    .from(purchaseRequests)
    .where(eq(purchaseRequests.id, input.id))
    .limit(1);
  if (!existing) return fail("NOT_FOUND", "Request tidak ditemukan");
  if (existing.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Request dari outlet lain");
  }
  if (existing.status === "cancelled") {
    return fail("ALREADY_CANCELLED", "Sudah dibatalkan");
  }
  if (existing.status === "completed") {
    return fail("ALREADY_COMPLETED", "Sudah selesai, tidak bisa dibatalkan");
  }

  const [updated] = await db
    .update(purchaseRequests)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: session.user.id,
      cancelReason: reason,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(purchaseRequests.id, input.id))
    .returning();

  await logAudit({
    eventType: "purchase_request.cancel",
    userId: session.user.id,
    entityType: "purchase_request",
    entityId: input.id,
    payload: {
      summary: `Permintaan belanja dibatalkan: ${reason}`,
      after: { status: "cancelled", reason },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit purchase_request.cancel]", e));

  return ok(updated);
}

/**
 * Tandai PR Selesai manual (feedback Anisa 2026-06-08). Owner/inventory boleh
 * menutup PR yang masih "open"/"partial" walau ada item yang sengaja TIDAK
 * dibeli (qty kurang sudah dianggap final oleh computePrStatus, tapi item yg
 * di-skip total / belum dibeli sama sekali butuh keputusan eksplisit ini).
 * PR/PO/GR boleh beda tanggal — penutupan ini murni keputusan owner, bukan
 * berbasis tanggal. Idempotent-ish: completed lagi ditolak halus.
 */
export async function markPurchaseRequestComplete(
  requestId: string,
): Promise<ApiResult<PurchaseRequest>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase_request.receive")) {
    return fail("FORBIDDEN", "Tidak punya hak menutup PR");
  }
  const [existing] = await db
    .select()
    .from(purchaseRequests)
    .where(eq(purchaseRequests.id, requestId))
    .limit(1);
  if (!existing) return fail("NOT_FOUND", "Request tidak ditemukan");
  if (existing.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Request dari outlet lain");
  }
  if (existing.status === "cancelled") {
    return fail("ALREADY_CANCELLED", "Sudah dibatalkan, tidak bisa diselesaikan");
  }
  if (existing.status === "completed") {
    return fail("ALREADY_COMPLETED", "PR sudah selesai");
  }

  const [updated] = await db
    .update(purchaseRequests)
    .set({
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(purchaseRequests.id, requestId))
    .returning();

  await logAudit({
    eventType: "purchase_request.complete",
    userId: session.user.id,
    entityType: "purchase_request",
    entityId: requestId,
    payload: {
      summary: "Permintaan belanja ditandai Selesai manual oleh owner",
      before: { status: existing.status },
      after: { status: "completed" },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit purchase_request.complete]", e));

  return ok(updated);
}

export async function markWhatsappSent(
  requestId: string,
): Promise<ApiResult<{ ok: true }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase_request.create")) {
    return fail("FORBIDDEN", "Tidak punya hak akses");
  }
  const [existing] = await db
    .select({ id: purchaseRequests.id, outletId: purchaseRequests.outletId })
    .from(purchaseRequests)
    .where(eq(purchaseRequests.id, requestId))
    .limit(1);
  if (!existing) return fail("NOT_FOUND", "Request tidak ditemukan");
  if (existing.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Request dari outlet lain");
  }

  await db
    .update(purchaseRequests)
    .set({ whatsappSentAt: new Date() })
    .where(eq(purchaseRequests.id, requestId));

  await logAudit({
    eventType: "purchase_request.whatsapp_sent",
    userId: session.user.id,
    entityType: "purchase_request",
    entityId: requestId,
    payload: { summary: "WA link dibuka" },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit purchase_request.whatsapp_sent]", e));

  return ok({ ok: true });
}

/* ============================================================================
 * Sesi AE-57 — List PR yang siap di-tarik ke Pembelian.
 *
 * Filter: status open OR partial, items yang masih outstanding. Outstanding
 * (feedback Cacil 2026-06-12, selaras computePrStatus): receivedQty == 0,
 * !rejected, dan BELUM ditarik ke pembelian/PO aktif (cek link purchase_items
 * → purchases non-cancelled). Sort: oldest first (FIFO).
 *
 * Per item enriched dengan:
 *  - outstandingQty = requestedQty - receivedQty
 *  - suggestedSupplierId = supplier_ingredients WHERE isPrimary=true
 *  - suggestedUnitCost = supplier_ingredients.unitCost
 *
 * Hard limit 50 PR untuk avoid heavy payload.
 * ========================================================================== */
export async function listOpenPurchaseRequestsForPurchase(): Promise<
  ApiResult<PrForPurchase[]>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase_request.view")) {
    return fail("FORBIDDEN", "Tidak punya hak akses");
  }
  if (!hasPermission(session.user.role, "purchase.create")) {
    return fail("FORBIDDEN", "Tidak punya hak buat pembelian");
  }

  const requestRows = await db
    .select({
      request: purchaseRequests,
      createdByName: users.name,
    })
    .from(purchaseRequests)
    .leftJoin(users, eq(users.id, purchaseRequests.createdBy))
    .where(
      and(
        eq(purchaseRequests.outletId, session.user.outletId),
        isNull(purchaseRequests.deletedAt),
        inArray(purchaseRequests.status, ["open", "partial"]),
      ),
    )
    .orderBy(purchaseRequests.createdAt) // oldest first
    .limit(50);

  if (requestRows.length === 0) return ok([]);

  const requestIds = requestRows.map((r) => r.request.id);
  const itemRows = await db
    .select()
    .from(purchaseRequestItems)
    .where(
      and(
        inArray(purchaseRequestItems.requestId, requestIds),
        isNull(purchaseRequestItems.rejectedAt),
      ),
    )
    .orderBy(purchaseRequestItems.requestId, purchaseRequestItems.displayOrder);

  // Resolve suggested supplier per ingredient (only ingredient-linked items)
  const ingIds = Array.from(
    new Set(
      itemRows
        .map((i) => i.ingredientId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const suggestedSupplierByIng = new Map<
    string,
    { supplierId: string; supplierName: string; unitCost: number }
  >();
  if (ingIds.length > 0) {
    const sup = await db
      .select({
        ingredientId: supplierIngredients.ingredientId,
        supplierId: supplierIngredients.supplierId,
        supplierName: suppliers.name,
        unitCost: supplierIngredients.unitCost,
        isPrimary: supplierIngredients.isPrimary,
      })
      .from(supplierIngredients)
      .innerJoin(suppliers, eq(suppliers.id, supplierIngredients.supplierId))
      .where(
        and(
          eq(supplierIngredients.outletId, session.user.outletId),
          inArray(supplierIngredients.ingredientId, ingIds),
          isNull(supplierIngredients.deletedAt),
        ),
      );
    // Prefer isPrimary=true; fallback ke first row jika ingredient tidak punya
    // primary. Sesi AE-176 — sederhanakan: set kalau belum ada ATAU baris ini
    // primary (primary selalu menang). (dulu ada cabang mati `r.isPrimary && !existing`).
    for (const r of sup) {
      const existing = suggestedSupplierByIng.get(r.ingredientId);
      if (!existing || r.isPrimary) {
        suggestedSupplierByIng.set(r.ingredientId, {
          supplierId: r.supplierId,
          supplierName: r.supplierName,
          unitCost: Number(r.unitCost),
        });
      }
    }
  }

  /* Feedback Cacil 2026-06-12 — definisi outstanding diselaraskan dgn
   * computePrStatus + categorizePrItem:
   *  - receivedQty > 0 → SUDAH dibeli (qty kurang = keputusan final owner,
   *    sesi AE-177/Anisa) → jangan tawarkan lagi (dulu muncul lagi sbg sisa
   *    → risiko dobel-beli).
   *  - sudah ditarik ke PO aktif (ordered, GR belum) → jangan tawarkan lagi
   *    → cegah dobel-tarik selagi barang dalam perjalanan. */
  const activeLinkIds = await fetchActivePurchaseLinkIds(
    itemRows.map((i) => i.id),
  );

  // Group items per request
  const itemsByRequest = new Map<string, PrItemForPurchase[]>();
  for (const it of itemRows) {
    /* Feedback Cacil 2026-06-12 (audit lanjutan) — pakai decimal mirror
     * (= truth, sesi AE-16/AE-62e). Kolom bigint = max(1, floor(qty)) →
     * request staff 0.5 Kg tampil/prefill jadi 1 Kg kalau baca bigint. */
    const reqDecimal = it.requestedQtyDecimal
      ? Number(it.requestedQtyDecimal)
      : NaN;
    const requestedQty =
      Number.isFinite(reqDecimal) && reqDecimal > 0
        ? reqDecimal
        : Number(it.requestedQty);
    const recvDecimal = it.receivedQtyDecimal
      ? Number(it.receivedQtyDecimal)
      : NaN;
    const receivedQty =
      Number.isFinite(recvDecimal) && recvDecimal > 0
        ? recvDecimal
        : Number(it.receivedQty);
    const outstandingQty = requestedQty - receivedQty;
    if (receivedQty > 0) continue; // sudah dibeli (under-buy = final owner)
    if (activeLinkIds.has(it.id)) continue; // sudah dalam PO aktif (menunggu GR)

    const suggested = it.ingredientId
      ? suggestedSupplierByIng.get(it.ingredientId)
      : null;

    const list = itemsByRequest.get(it.requestId) ?? [];
    list.push({
      purchaseRequestItemId: it.id,
      ingredientId: it.ingredientId,
      ingredientName: it.ingredientNameSnapshot,
      unit: it.unitSnapshot,
      requestedQty,
      receivedQty,
      outstandingQty,
      suggestedSupplierId: suggested?.supplierId ?? null,
      suggestedSupplierName: suggested?.supplierName ?? null,
      suggestedUnitCost: suggested?.unitCost ?? null,
      notes: it.notes,
    });
    itemsByRequest.set(it.requestId, list);
  }

  // Build PrForPurchase[] — skip PRs that have no outstanding items
  const result: PrForPurchase[] = [];
  for (const r of requestRows) {
    const items = itemsByRequest.get(r.request.id) ?? [];
    if (items.length === 0) continue;
    const totalOutstanding = items.reduce(
      (sum, i) => sum + i.outstandingQty,
      0,
    );
    const labelDate = r.request.createdAt.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    });
    result.push({
      requestId: r.request.id,
      label: `PR ${r.request.id.slice(0, 8)} · ${labelDate}`,
      status: r.request.status as PurchaseRequestStatus,
      createdAt: r.request.createdAt,
      createdByName: r.createdByName,
      notes: r.request.notes,
      outstandingItemCount: items.length,
      totalOutstandingQty: totalOutstanding,
      items,
    });
  }

  return ok(result);
}
