"use server";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  expenseCategories,
  expenses,
  ingredients,
  inventoryMovements,
  purchaseItems,
  purchaseRequestItems,
  purchaseRequests,
  purchases,
  supplierIngredients,
} from "@/db/schema";
import { computePrStatus } from "@/features/purchase-requests/group-items-pure";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import {
  computeNewStock,
  formatMovementDelta,
  resolveStockDecimal,
} from "@/lib/stock-decimal";
import {
  convertPurchaseQty,
  type PackInfo,
} from "@/lib/unit-conversion";
import {
  cancelPurchaseSchema,
  createPurchaseSchema,
  markPaidSchema,
} from "./schemas";
import {
  fetchPurchaseById,
  fetchPurchaseDetail,
  fetchPurchases,
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
  type TopOutstandingItem,
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

function paymentMethodLabel(m: PaymentMethod): string {
  return {
    cash: "Cash",
    transfer_bca: "Transfer BCA",
    transfer_bri: "Transfer BRI",
    transfer_other: "Transfer lain",
    top: "TOP (kredit)",
  }[m];
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
): Promise<ApiResult<{ id: string; totalAmount: number; movementsCreated: number }>> {
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
        const res = convertPurchaseQty({
          qty: item.qty,
          fromUnit: item.unit ?? ing.unit,
          masterUnit: ing.unit,
          pack: packMap.get(item.ingredientId) ?? null,
          /* Sesi AE-62af — server juga honor ingredient-scoped packs supaya
           * client convert valid lewat di server re-validate path. */
          ingredientPacks:
            (ing.packConversions as
              | Array<{ unitLabel: string; qtyPerBase: number }>
              | null) ?? null,
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
       *  3. receivedQty + qtyMaster <= requestedQty (anti-over-receive)
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

        // Validate each linked item
        for (const { item, ing, res } of resolved) {
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
          const requested = Number(prItem.requestedQty);
          const received = Number(prItem.receivedQty);
          const incoming = Math.max(1, Math.round(res.qtyMaster));
          if (received + incoming > requested) {
            throw new Error(
              `PR_OVER_RECEIVE:${ing.name}:${requested - received}`,
            );
          }
        }
      }

      // Compute total. Sesi AE — qty boleh decimal (mis. 0.5 kg × Rp 10.000),
      // jadi pakai floating math + round ke nearest rupiah di akhir per-line
      // untuk konsistensi sama UI live preview.
      // Sesi AE-43 — totalCost tetap pakai raw qty × raw unitCost supaya
      // rupiah identik dengan apa yang owner liat di nota; conversion
      // hanya dipakai untuk stock + cost master.
      let total = 0;
      for (const item of v.items) {
        total += Math.round(item.qty * item.unitCost);
      }

      // Insert header.
      const [created] = await tx
        .insert(purchases)
        .values({
          outletId: session.user.outletId,
          supplierId: v.supplierId,
          purchaseDate: v.purchaseDate,
          paymentMethod: v.paymentMethod,
          paymentTermDays: v.paymentTermDays,
          dueDate,
          invoiceNo: v.invoiceNo ?? null,
          notes: v.notes ?? null,
          receiptImageUrl: v.receiptImageUrl ?? null,
          status: isTop ? "pending_payment" : "paid",
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
      for (const { item, ing, res } of resolved) {
        const totalCost = Math.round(item.qty * item.unitCost);
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

        // Update stock.
        const updateValues: Record<string, unknown> = {
          currentStock: newStock.bigint,
          currentStockDecimal: newStock.decimal,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        };
        if (v.updateCost) {
          updateValues.costPerUnit = unitCostMaster;
          updateValues.costLastChangedAt = new Date();
        }
        await tx
          .update(ingredients)
          .set(updateValues)
          .where(eq(ingredients.id, item.ingredientId));

        // Movement.
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
            reason: v.invoiceNo
              ? `Purchase ${v.invoiceNo}`
              : `Purchase ${created.id.slice(0, 8)}`,
            createdBy: session.user.id,
          })
          .returning({ id: inventoryMovements.id });

        // Item — qty bigint = rounded RAW staff input (matches purchase
        // nota for owner audit). qtyDecimal = exact raw. unitCost +
        // totalCost = raw rupiah (no scale). movement.qtyDeltaDecimal
        // adalah source of truth untuk stock — purchase_items adalah
        // jurnal nota / kas.
        const rawQtyBigint = Math.max(1, Math.round(item.qty));
        await tx.insert(purchaseItems).values({
          purchaseId: created.id,
          ingredientId: item.ingredientId,
          qty: rawQtyBigint,
          qtyDecimal: qtyDecimalStr,
          unitCost: item.unitCost,
          totalCost,
          movementId: movement.id,
          ingredientNameSnapshot: ing.name,
          unitSnapshot: ing.unit,
          unitOverride,
          sectionSnapshot: ing.section,
          purchaseRequestItemId: item.purchaseRequestItemId ?? null,
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
              description: `Pembelanjaan ${paymentMethodLabel(v.paymentMethod)}${
                v.invoiceNo ? ` · ${v.invoiceNo}` : ""
              }${v.notes ? ` · ${v.notes}` : ""}`,
              amount: total,
              paymentMethod: expensePaymentMethod(v.paymentMethod),
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
    if (msg.startsWith("PR_OVER_RECEIVE:")) {
      // Format: PR_OVER_RECEIVE:<ingredientName>:<remainingQty>
      const rest = msg.slice("PR_OVER_RECEIVE:".length);
      const sep = rest.indexOf(":");
      const ingName = sep > 0 ? rest.slice(0, sep) : "?";
      const remaining = sep > 0 ? rest.slice(sep + 1) : "?";
      return fail(
        "VALIDATION_ERROR",
        `Bahan "${ingName}": maks ${remaining} (sisa outstanding PR)`,
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
      () =>
        postJournalForPurchaseCreate({
          outletId: session.user.outletId,
          purchaseId: resultId,
          purchaseLabel:
            v.invoiceNo ?? `${v.paymentMethod} ${v.purchaseDate}`,
          paymentMethod: v.paymentMethod,
          total: totalAmount,
          lines: sectionLines,
          entryDate: v.purchaseDate,
          actorId: session.user.id,
        }),
      "purchase_create",
    );
  }

  return ok({ id: resultId, totalAmount, movementsCreated });
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

      /* Sesi AE-43 — reverse pakai `inventory_movements.qty_delta_decimal`
       * (master unit) via join `movementId`, BUKAN `purchase_items.qty_decimal`
       * (raw input staff). Untuk legacy purchase pre-AE-43 keduanya identik
       * (no conversion was applied), jadi backward-compat. Untuk purchase
       * baru dengan conversion: reverse harus pakai master-unit delta supaya
       * stock balance benar. */
      const items = await tx
        .select({
          purchaseItem: purchaseItems,
          movementQtyDeltaDecimal: inventoryMovements.qtyDeltaDecimal,
          movementUnitCost: inventoryMovements.unitCostAtMovement,
        })
        .from(purchaseItems)
        .leftJoin(
          inventoryMovements,
          eq(purchaseItems.movementId, inventoryMovements.id),
        )
        .where(eq(purchaseItems.purchaseId, v.id));

      for (const { purchaseItem: item, movementQtyDeltaDecimal, movementUnitCost } of items) {
        const [ing] = await tx
          .select()
          .from(ingredients)
          .where(eq(ingredients.id, item.ingredientId))
          .for("update")
          .limit(1);
        if (!ing) continue; // ingredient deleted — skip

        // Resolve master-unit qty dari movement. Kalau movement row hilang
        // (data corrupt rare), fallback ke purchase_items.qtyDecimal (legacy
        // raw — sama dengan behavior pre-AE-43).
        let reverseQty: number;
        if (movementQtyDeltaDecimal) {
          const parsed = parseFloat(movementQtyDeltaDecimal);
          reverseQty = Number.isFinite(parsed) ? parsed : 0;
        } else {
          reverseQty = resolveStockDecimal(item.qty, item.qtyDecimal);
        }
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
          .where(eq(ingredients.id, item.ingredientId));

        // Counter-movement for traceability — pakai unit cost dari original
        // movement (sudah di-scale ke master unit kalau ada conversion).
        const movementDelta = formatMovementDelta(-reverseQty);
        await tx.insert(inventoryMovements).values({
          outletId: session.user.outletId,
          ingredientId: item.ingredientId,
          kind: "adjust",
          qtyDelta: movementDelta.bigint,
          qtyDeltaDecimal: movementDelta.decimal,
          unitCostAtMovement: movementUnitCost ?? item.unitCost,
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
      const items = await db
        .select({
          section: purchaseItems.sectionSnapshot,
          totalCost: purchaseItems.totalCost,
        })
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, v.id));
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
      const todayWib = new Date().toISOString().slice(0, 10);
      const { fireJournalHook, postJournalForPurchaseCancel } = await import(
        "@/features/accounting/hooks"
      );
      fireJournalHook(
        () =>
          postJournalForPurchaseCancel({
            outletId: session.user.outletId,
            purchaseId: v.id,
            purchaseLabel:
              purchaseRow.invoiceNo ??
              `${purchaseRow.paymentMethod} ${purchaseRow.purchaseDate}`,
            paymentMethod: purchaseRow.paymentMethod as
              | "cash"
              | "transfer_bca"
              | "transfer_bri"
              | "transfer_other"
              | "top",
            total: Number(purchaseRow.totalAmount),
            lines: sectionLines,
            entryDate: todayWib,
            actorId: session.user.id,
          }),
        "purchase_cancel",
      );
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

  let expenseId: string | null = null;
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

      // Auto-create kas expense (best-effort).
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
            expenseDate: todayJakartaIso(),
            categoryId: defaultCat.id,
            description: `Lunas TOP — ${paymentMethodLabel(v.paymentMethod)}${
              p.invoiceNo ? ` · ${p.invoiceNo}` : ""
            } (purchase ${p.id.slice(0, 8)})`,
            amount: p.totalAmount,
            paymentMethod: expensePaymentMethod(v.paymentMethod),
            createdBy: session.user.id,
          })
          .returning({ id: expenses.id });
        expenseId = exp.id;
      }

      await tx
        .update(purchases)
        .set({
          status: "paid",
          paidAt: new Date(),
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
      summary: `Tandai lunas — ${paymentMethodLabel(v.paymentMethod)}`,
      context: { paymentMethod: v.paymentMethod, expenseId },
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
    if (purchaseRow) {
      const todayWib = new Date().toISOString().slice(0, 10);
      const { fireJournalHook, postJournalForPurchasePay } = await import(
        "@/features/accounting/hooks"
      );
      fireJournalHook(
        () =>
          postJournalForPurchasePay({
            outletId: session.user.outletId,
            purchaseId: v.id,
            purchaseLabel:
              purchaseRow.invoiceNo ??
              `purchase ${purchaseRow.id.slice(0, 8)}`,
            paymentMethod: v.paymentMethod as
              | "cash"
              | "transfer_bca"
              | "transfer_bri"
              | "transfer_other",
            total: Number(purchaseRow.totalAmount),
            entryDate: todayWib,
            actorId: session.user.id,
          }),
        "purchase_pay",
      );
    }
  }

  return ok({ id: v.id, expenseId });
}

// Re-export query type so action callers don't need to know the queries layer.
export type { Purchase };

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
