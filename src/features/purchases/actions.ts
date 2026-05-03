"use server";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  expenseCategories,
  expenses,
  ingredients,
  inventoryMovements,
  purchaseItems,
  purchases,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
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

      // Compute total.
      let total = 0;
      for (const item of v.items) {
        total += item.qty * item.unitCost;
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
      for (const item of v.items) {
        const ing = ingById.get(item.ingredientId)!;
        const totalCost = item.qty * item.unitCost;

        // Update stock.
        const newStock = ing.currentStock + item.qty;
        const updateValues: Record<string, unknown> = {
          currentStock: newStock,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        };
        if (v.updateCost) {
          updateValues.costPerUnit = item.unitCost;
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
            qtyDelta: item.qty,
            unitCostAtMovement: item.unitCost,
            referenceType: "manual",
            referenceId: created.id,
            reason: v.invoiceNo
              ? `Purchase ${v.invoiceNo}`
              : `Purchase ${created.id.slice(0, 8)}`,
            createdBy: session.user.id,
          })
          .returning({ id: inventoryMovements.id });

        // Item.
        await tx.insert(purchaseItems).values({
          purchaseId: created.id,
          ingredientId: item.ingredientId,
          qty: item.qty,
          unitCost: item.unitCost,
          totalCost,
          movementId: movement.id,
          ingredientNameSnapshot: ing.name,
          unitSnapshot: ing.unit,
          sectionSnapshot: ing.section,
        });

        movementsCreated++;
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
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "INGREDIENT_NOT_FOUND")
      return fail("NOT_FOUND", "Salah satu bahan tidak ditemukan / non-aktif");
    if (msg === "OUTLET_MISMATCH")
      return fail("FORBIDDEN", "Bahan dari outlet lain — kontak admin");
    return fail("DB_ERROR", msg);
  }

  await logAudit({
    eventType: "purchase.create",
    userId: session.user.id,
    entityType: "purchase",
    entityId: resultId,
    payload: {
      summary: `Purchase ${paymentMethodLabel(v.paymentMethod)} ${v.purchaseDate} (${v.items.length} item, total ${totalAmount})`,
      context: {
        purchaseDate: v.purchaseDate,
        paymentMethod: v.paymentMethod,
        itemCount: v.items.length,
        totalAmount,
        autoExpense: shouldCreateKas && !isTop,
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

      // Reverse stock per item.
      const items = await tx
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, v.id));

      for (const item of items) {
        const [ing] = await tx
          .select()
          .from(ingredients)
          .where(eq(ingredients.id, item.ingredientId))
          .for("update")
          .limit(1);
        if (!ing) continue; // ingredient deleted — skip
        const newStock = ing.currentStock - item.qty;
        if (newStock < 0) throw new Error(`NEGATIVE_STOCK:${ing.name}`);
        await tx
          .update(ingredients)
          .set({
            currentStock: newStock,
            updatedAt: new Date(),
            updatedBy: session.user.id,
          })
          .where(eq(ingredients.id, item.ingredientId));

        // Counter-movement for traceability.
        await tx.insert(inventoryMovements).values({
          outletId: session.user.outletId,
          ingredientId: item.ingredientId,
          kind: "adjust",
          qtyDelta: -item.qty,
          unitCostAtMovement: item.unitCost,
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
    const msg = e instanceof Error ? e.message : "Database error";
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
    return fail("DB_ERROR", msg);
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
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "NOT_FOUND")
      return fail("NOT_FOUND", "Pembelian tidak ditemukan");
    if (msg === "BAD_STATE")
      return fail(
        "BAD_STATE",
        "Pembelian tidak dalam status pending_payment",
      );
    return fail("DB_ERROR", msg);
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
