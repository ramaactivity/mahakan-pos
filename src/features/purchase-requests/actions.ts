"use server";

import { and, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  purchaseRequestItems,
  purchaseRequests,
  shifts,
  users,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import {
  fail,
  ok,
  type ApiResult,
  type CancelPurchaseRequestInput,
  type CreatePurchaseRequestInput,
  type LowStockIngredient,
  type PurchaseRequest,
  type PurchaseRequestStatus,
  type PurchaseRequestWithItems,
  type ReceiveItemInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
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
  for (const item of input.items) {
    if (!item.ingredientId) {
      return fail("MISSING_INGREDIENT", "Item harus pilih bahan");
    }
    if (!Number.isFinite(item.requestedQty) || item.requestedQty <= 0) {
      return fail("INVALID_QTY", `Qty harus > 0`);
    }
  }

  // Snapshot ingredients (name + unit + cross-outlet validate).
  const ingredientIds = input.items.map((i) => i.ingredientId);
  const ingredientRows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      outletId: ingredients.outletId,
    })
    .from(ingredients)
    .where(inArray(ingredients.id, ingredientIds));

  const byId = new Map(ingredientRows.map((r) => [r.id, r]));
  for (const item of input.items) {
    const ing = byId.get(item.ingredientId);
    if (!ing) return fail("INGREDIENT_NOT_FOUND", `Bahan tidak ditemukan`);
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
      const ing = byId.get(item.ingredientId)!;
      await tx.insert(purchaseRequestItems).values({
        requestId: request.id,
        ingredientId: ing.id,
        ingredientNameSnapshot: ing.name,
        unitSnapshot: ing.unit,
        requestedQty: Math.floor(item.requestedQty),
        receivedQty: 0,
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

  return ok(result);
}

export interface ListPurchaseRequestsOptions {
  status?: PurchaseRequestStatus | "all";
  /** Default 50. */
  limit?: number;
}

export async function listPurchaseRequests(
  opts: ListPurchaseRequestsOptions = {},
): Promise<ApiResult<PurchaseRequestWithItems[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase_request.view")) {
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

  const byRequestId = new Map<string, typeof itemRows>();
  for (const it of itemRows) {
    if (!byRequestId.has(it.requestId)) byRequestId.set(it.requestId, []);
    byRequestId.get(it.requestId)!.push(it);
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
 * Receive qty for a single item. Recompute parent status afterward:
 *   all received_qty = 0          → open
 *   any > 0 dan < requested       → partial
 *   all received_qty == requested → completed (stamp completed_at)
 */
export async function receiveItem(
  input: ReceiveItemInput,
): Promise<ApiResult<{ requestId: string; newStatus: PurchaseRequestStatus }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "purchase_request.receive")) {
    return fail("FORBIDDEN", "Tidak punya hak terima barang");
  }
  if (!Number.isFinite(input.receivedQty) || input.receivedQty < 0) {
    return fail("INVALID_QTY", "Qty tidak valid");
  }

  type ReceiveError =
    | "ITEM_NOT_FOUND"
    | "QTY_EXCEEDS_REQUESTED"
    | "REQUEST_NOT_FOUND"
    | "CROSS_OUTLET"
    | "REQUEST_CANCELLED";
  type ReceiveResult =
    | { error: ReceiveError }
    | { requestId: string; newStatus: PurchaseRequestStatus };

  const result: ReceiveResult = await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.id, input.itemId))
      .limit(1);
    if (!item) return { error: "ITEM_NOT_FOUND" };

    if (input.receivedQty > Number(item.requestedQty)) {
      return { error: "QTY_EXCEEDS_REQUESTED" };
    }

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

    await tx
      .update(purchaseRequestItems)
      .set({
        receivedQty: Math.floor(input.receivedQty),
        updatedAt: new Date(),
      })
      .where(eq(purchaseRequestItems.id, input.itemId));

    // Recompute parent status from sibling items.
    const [agg] = await tx
      .select({
        totalReceived: sql<string>`COALESCE(SUM(${purchaseRequestItems.receivedQty}), 0)`,
        totalRequested: sql<string>`COALESCE(SUM(${purchaseRequestItems.requestedQty}), 0)`,
        anyPositive: sql<boolean>`BOOL_OR(${purchaseRequestItems.receivedQty} > 0)`,
      })
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.requestId, parent.id));

    let newStatus: PurchaseRequestStatus = "open";
    const totalReceived = Number(agg.totalReceived);
    const totalRequested = Number(agg.totalRequested);
    if (totalRequested > 0 && totalReceived >= totalRequested) {
      newStatus = "completed";
    } else if (agg.anyPositive) {
      newStatus = "partial";
    }

    if (newStatus !== parent.status) {
      await tx
        .update(purchaseRequests)
        .set({
          status: newStatus,
          completedAt: newStatus === "completed" ? new Date() : null,
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
    const messages: Record<ReceiveError, string> = {
      ITEM_NOT_FOUND: "Item tidak ditemukan",
      QTY_EXCEEDS_REQUESTED: "Qty diterima melebihi qty diminta",
      REQUEST_NOT_FOUND: "Request tidak ditemukan",
      CROSS_OUTLET: "Request dari outlet lain",
      REQUEST_CANCELLED: "Request sudah dibatalkan",
    };
    return fail(result.error, messages[result.error]);
  }

  await logAudit({
    eventType: "purchase_request.receive",
    userId: session.user.id,
    entityType: "purchase_request_item",
    entityId: input.itemId,
    payload: {
      summary: `Qty diterima: ${input.receivedQty}; status sekarang: ${result.newStatus}`,
      after: {
        receivedQty: input.receivedQty,
        requestStatus: result.newStatus,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit purchase_request.receive]", e));

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
