"use server";

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  expenseCategories,
  expenses,
  menuItems,
  shifts,
  transactionItemModifiers,
  transactionItems,
  transactions,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { consumeApproverToken } from "@/lib/auth/approver";
import { logAudit } from "@/lib/audit/logger";
import {
  applyStockDeductions,
  computeStockFlowForOrder,
  reevaluateSoldOutForIngredients,
  restoreStockForTransaction,
} from "@/features/inventory/transaction-flow";
import {
  fetchTransactionByClientRefId,
  fetchTransactionById,
  fetchTransactions,
  type ListTransactionsOptions,
} from "./queries";
import {
  createTransactionSchema,
  refundTransactionSchema,
  voidTransactionSchema,
} from "./schemas";
import {
  endOfWibDayUtc,
  formatTransactionNumber,
  startOfWibDayUtc,
  todayWibYmd,
} from "./helpers";
import { validateCreateTransaction } from "./validation";
import {
  fail,
  ok,
  isOk,
  type ApiResult,
  type CloseOpenBillInput,
  type CreateTransactionInput,
  type Paginated,
  type RefundTransactionInput,
  type SaveOpenBillInput,
  type Transaction,
  type TransactionWithItems,
  type VoidTransactionInput,
} from "./types";
import type { MenuItem } from "@/features/menu";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

// ---------- Reads ----------

export async function listTransactions(
  opts: ListTransactionsOptions = {},
): Promise<ApiResult<Paginated<Transaction>>> {
  await requireSession();
  return ok(await fetchTransactions(opts));
}

export async function getTransaction(
  id: string,
): Promise<ApiResult<TransactionWithItems>> {
  await requireSession();
  const row = await fetchTransactionById(id);
  if (!row) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  return ok(row);
}

// ---------- createTransaction ----------

export async function createTransaction(
  input: CreateTransactionInput,
): Promise<ApiResult<TransactionWithItems>> {
  const session = await requireSession();

  const parsed = createTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  if (v.cashierId !== session.user.id) {
    return fail("FORBIDDEN", "cashierId harus sama dengan session user");
  }

  // Idempotency
  if (v.clientRefId) {
    const existing = await fetchTransactionByClientRefId(v.clientRefId);
    if (existing) {
      const full = await fetchTransactionById(existing.id);
      if (full) return ok(full);
    }
  }

  // Shift must be active and belong to cashier
  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, v.shiftId))
    .limit(1);
  if (!shift) return fail("SHIFT_NOT_FOUND", "Shift tidak ditemukan");
  if (shift.status !== "open") {
    return fail("SHIFT_CLOSED", "Shift sudah ditutup");
  }
  if (shift.userId !== session.user.id) {
    return fail("SHIFT_OWNERSHIP", "Shift bukan milik kamu");
  }

  // Approver token consumption — if discount applied AND user is staff
  let discountApproverId: string | null = null;
  if (v.discountAmount > 0 && session.user.role === "staff") {
    if (!v.discountApproverToken) {
      return fail(
        "APPROVER_REQUIRED",
        "Staff butuh approver untuk apply discount",
      );
    }
    try {
      const consumed = await consumeApproverToken(
        v.discountApproverToken,
        "pos.discount.apply",
        null,
      );
      discountApproverId = consumed.approverId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Token gagal";
      return fail("APPROVER_TOKEN_INVALID", msg);
    }
  }

  // Authorize discount apply for non-staff (Owner/Manager use their own session)
  if (v.discountAmount > 0 && session.user.role !== "staff") {
    if (!hasPermission(session.user.role, "pos.discount.apply")) {
      return fail("FORBIDDEN", "Tidak punya hak apply discount");
    }
  }

  // Fetch all referenced menu items in one query
  const menuItemIds = Array.from(new Set(v.items.map((i) => i.menuItemId)));
  const menuRows: MenuItem[] = await db
    .select()
    .from(menuItems)
    .where(inArray(menuItems.id, menuItemIds));
  if (menuRows.length !== menuItemIds.length) {
    return fail("MENU_ITEM_NOT_FOUND", "Beberapa item tidak ditemukan");
  }

  // Validate / recompute money server-side
  const validation = validateCreateTransaction(v, menuRows);
  if (!validation.ok) {
    return fail(validation.code, validation.message);
  }

  // Build category lookup once for snapshot field on items
  const categoryNameByMenuId = new Map<string, string>();
  {
    const catIds = Array.from(
      new Set(menuRows.map((m) => m.categoryId)),
    );
    const cats = await db
      .select({ id: sql<string>`id`, name: sql<string>`name` })
      .from(sql`categories`)
      .where(sql`id in ${catIds}`);
    for (const c of cats) categoryNameByMenuId.set(c.id, c.name);
  }
  const menuById = new Map(menuRows.map((m) => [m.id, m]));

  // Atomic insert: advisory lock + sequence + insert in single transaction
  const ymd = todayWibYmd();
  const dayStart = startOfWibDayUtc();
  const dayEnd = endOfWibDayUtc();

  try {
    const result = await db.transaction(async (tx) => {
      // Acquire advisory lock keyed on outlet+day to serialize seq generation.
      // Lock auto-releases at COMMIT/ROLLBACK.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`trx-seq-${session.user.outletId}-${ymd}`}))`,
      );

      // Count today's transactions for this outlet to derive sequence
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(transactions)
        .where(
          and(
            eq(transactions.outletId, session.user.outletId),
            gte(transactions.createdAt, dayStart),
            lt(transactions.createdAt, dayEnd),
          ),
        );

      const transactionNumber = formatTransactionNumber(ymd, count + 1);

      // Insert transaction first to get its id (needed by movement.referenceId).
      // We'll patch cogs after computing flow.
      const [insertedTrx] = await tx
        .insert(transactions)
        .values({
          outletId: session.user.outletId,
          shiftId: v.shiftId,
          cashierId: session.user.id,
          clientRefId: v.clientRefId ?? null,
          transactionNumber,
          pagerNumber: v.pagerNumber,
          orderType: v.orderType,
          subtotal: validation.recomputedSubtotal,
          discountType: v.discountType,
          discountValue: v.discountValue,
          discountAmount: validation.recomputedDiscountAmount,
          discountReason: v.discountReason,
          total: validation.recomputedTotal,
          paymentMethod: v.paymentMethod,
          cashReceived: v.paymentMethod === "cash" ? v.cashReceived : null,
          cashChange: v.paymentMethod === "cash" ? v.cashChange : null,
          status: "paid",
          discountApprover: discountApproverId,
        })
        .returning();

      const itemsInserted = await tx
        .insert(transactionItems)
        .values(
          v.items.map((it) => {
            const menu = menuById.get(it.menuItemId)!;
            return {
              transactionId: insertedTrx.id,
              menuItemId: it.menuItemId,
              itemName: menu.name,
              itemCategoryName:
                categoryNameByMenuId.get(menu.categoryId) ?? "",
              variant: it.variant,
              unitPrice: it.unitPrice,
              quantity: it.quantity,
              modifiersPriceDelta: it.modifiersPriceDelta,
              subtotal: it.subtotal,
              note: it.note,
              openPriceNote: it.openPriceNote,
            };
          }),
        )
        .returning();

      // ---- Phase 2 inventory flow: COGS + auto-deduct ----
      const flow = await computeStockFlowForOrder(
        tx,
        session.user.outletId,
        v.items.map((it, idx) => ({
          transactionItemId: itemsInserted[idx].id,
          menuItemId: it.menuItemId,
          variant: it.variant,
          quantity: it.quantity,
        })),
      );

      // Patch transaction.cogs (only if any item resolved a recipe)
      const hasAnyCogs = flow.itemsWithoutRecipe.length < v.items.length;
      if (hasAnyCogs) {
        await tx
          .update(transactions)
          .set({ cogs: flow.totalCogs })
          .where(eq(transactions.id, insertedTrx.id));
      }

      // Patch each transaction_item.cogs that has a resolved recipe
      for (const ti of itemsInserted) {
        const cogsForItem = flow.itemCogsByTrxItemId.get(ti.id);
        if (cogsForItem !== undefined && cogsForItem > 0) {
          await tx
            .update(transactionItems)
            .set({ cogs: cogsForItem })
            .where(eq(transactionItems.id, ti.id));
        }
      }

      // Apply ingredient deductions + insert sale_deduct movements
      await applyStockDeductions(
        tx,
        session.user.outletId,
        session.user.id,
        insertedTrx.id,
        flow,
      );

      const modRows: Array<typeof transactionItemModifiers.$inferInsert> = [];
      v.items.forEach((it, idx) => {
        const itemId = itemsInserted[idx].id;
        for (const mod of it.modifiers) {
          modRows.push({
            transactionItemId: itemId,
            modifierSlug: mod.modifierSlug,
            selectedValue: mod.selectedValue,
            priceDelta: mod.priceDelta,
          });
        }
      });
      const modsInserted = modRows.length
        ? await tx
            .insert(transactionItemModifiers)
            .values(modRows)
            .returning()
        : [];

      return {
        trx: { ...insertedTrx, cogs: hasAnyCogs ? flow.totalCogs : null },
        items: itemsInserted.map((it) => ({
          ...it,
          cogs: flow.itemCogsByTrxItemId.get(it.id) ?? null,
        })),
        mods: modsInserted,
        deductedIngredientIds: Array.from(flow.deductionsByIngredient.keys()),
      };
    });

    // Best-effort sold-out re-eval after main tx commits.
    if (result.deductedIngredientIds.length > 0) {
      reevaluateSoldOutForIngredients(result.deductedIngredientIds).catch(
        (e) => console.error("[sold-out re-eval]", e),
      );
    }

    if (validation.recomputedDiscountAmount > 0) {
      // Compliment is implemented as a 100% discount with reason prefixed
      // "Compliment: ". Audit event differentiated so reports + compliance
      // can filter complimented transactions distinctly from regular promo
      // discounts.
      const isCompliment = (v.discountReason ?? "").startsWith("Compliment:");
      await logAudit({
        eventType: isCompliment
          ? "transaction.compliment.applied"
          : "transaction.discount.applied",
        userId: session.user.id,
        approverId: discountApproverId,
        entityType: "transaction",
        entityId: result.trx.id,
        payload: {
          summary: isCompliment
            ? `Compliment Rp${validation.recomputedDiscountAmount.toLocaleString("id-ID")} pada ${result.trx.transactionNumber} (${(v.discountReason ?? "").replace(/^Compliment:\s*/, "")})`
            : `Diskon ${v.discountType === "percent" ? `${v.discountValue}%` : `Rp${validation.recomputedDiscountAmount.toLocaleString("id-ID")}`} pada ${result.trx.transactionNumber} (${v.discountReason ?? "tanpa alasan"})`,
          context: {
            transactionNumber: result.trx.transactionNumber,
            discountType: v.discountType,
            discountValue: v.discountValue,
            discountAmount: validation.recomputedDiscountAmount,
            reason: v.discountReason,
            subtotalBefore: validation.recomputedSubtotal,
            totalAfter: validation.recomputedTotal,
            isCompliment,
          },
        },
        metadata: {
          outletId: session.user.outletId,
          actorRole: session.user.role,
        },
      });
    }

    return ok({
      ...result.trx,
      items: result.items.map((it) => ({
        ...it,
        modifiers: result.mods.filter((m) => m.transactionItemId === it.id),
      })),
    });
  } catch (e) {
    // Idempotency race: clientRefId UNIQUE collision
    if (
      e instanceof Error &&
      /client_ref_id|unique/i.test(e.message) &&
      v.clientRefId
    ) {
      const existing = await fetchTransactionByClientRefId(v.clientRefId);
      if (existing) {
        const full = await fetchTransactionById(existing.id);
        if (full) return ok(full);
      }
    }
    const msg = e instanceof Error ? e.message : "Database error";
    return fail("DB_ERROR", msg);
  }
}

// ---------- voidTransaction ----------

export async function voidTransaction(
  input: VoidTransactionInput,
): Promise<ApiResult<Transaction>> {
  const session = await requireSession();

  const parsed = voidTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  // Authorization: ALL roles require an approver PIN. Owner/Manager can
  // approve their own action (self-approval) — but the deliberate two-step
  // ritual reduces accidental void clicks and gives audit log a clean
  // approver record per Galih's request.
  if (!hasPermission(session.user.role, "pos.transaction.void")) {
    return fail("FORBIDDEN", "Tidak punya hak void");
  }
  if (!v.approverToken) {
    return fail("APPROVER_REQUIRED", "Void butuh PIN approver");
  }
  let approverId: string | null = null;
  try {
    const consumed = await consumeApproverToken(
      v.approverToken,
      "pos.transaction.void",
      v.transactionId,
    );
    approverId = consumed.approverId;
  } catch (e) {
    return fail(
      "APPROVER_TOKEN_INVALID",
      e instanceof Error ? e.message : "Token gagal",
    );
  }

  const [current] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, v.transactionId))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  if (current.status === "voided") {
    return fail("ALREADY_VOIDED", "Transaksi sudah di-void");
  }
  if (current.status === "refunded") {
    return fail(
      "BUSINESS_RULE_VIOLATION",
      "Transaksi sudah di-refund, tidak bisa di-void",
    );
  }

  const { updated, restoredIngredientIds } = await db.transaction(async (tx) => {
    const [updatedRow] = await tx
      .update(transactions)
      .set({
        status: "voided",
        voidedAt: new Date(),
        voidedBy: session.user.id,
        voidedApprover: approverId,
        voidReason: v.reason,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, v.transactionId))
      .returning();

    const restored = await restoreStockForTransaction(
      tx,
      session.user.outletId,
      session.user.id,
      v.transactionId,
      "void_restore",
    );

    return { updated: updatedRow, restoredIngredientIds: restored };
  });

  if (restoredIngredientIds.length > 0) {
    reevaluateSoldOutForIngredients(restoredIngredientIds).catch((e) =>
      console.error("[sold-out re-eval void]", e),
    );
  }

  await logAudit({
    eventType: "transaction.void",
    userId: session.user.id,
    approverId,
    entityType: "transaction",
    entityId: updated.id,
    payload: {
      summary: `Void TRX ${updated.transactionNumber} (${v.reason})`,
      context: {
        transactionNumber: updated.transactionNumber,
        total: updated.total,
        paymentMethod: updated.paymentMethod,
        reason: v.reason,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  return ok(updated);
}

// ---------- refundTransaction ----------

export async function refundTransaction(
  input: RefundTransactionInput,
): Promise<ApiResult<{ transaction: Transaction }>> {
  const session = await requireSession();

  const parsed = refundTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  // ALL roles require approver PIN — same rationale as void (deliberate
  // two-step + clean audit trail per Galih's request). Owner/Manager can
  // self-approve.
  if (!hasPermission(session.user.role, "pos.transaction.refund")) {
    return fail("FORBIDDEN", "Tidak punya hak refund");
  }
  if (!v.approverToken) {
    return fail("APPROVER_REQUIRED", "Refund butuh PIN approver");
  }
  let approverId: string | null = null;
  try {
    const consumed = await consumeApproverToken(
      v.approverToken,
      "pos.transaction.refund",
      v.transactionId,
    );
    approverId = consumed.approverId;
  } catch (e) {
    return fail(
      "APPROVER_TOKEN_INVALID",
      e instanceof Error ? e.message : "Token gagal",
    );
  }

  const [current] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, v.transactionId))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  if (current.status !== "paid") {
    return fail(
      "BUSINESS_RULE_VIOLATION",
      "Hanya transaksi paid yang bisa di-refund",
    );
  }
  if (current.paymentMethod !== "cash") {
    return fail(
      "REFUND_NOT_ALLOWED_NON_CASH",
      "Phase 1: hanya cash yang bisa di-refund",
    );
  }

  // Same WIB-day only
  const todayYmd = todayWibYmd();
  const trxYmd = todayWibYmd(current.createdAt);
  if (trxYmd !== todayYmd) {
    return fail(
      "REFUND_NOT_ALLOWED_PAST_DAY",
      "Refund hanya untuk transaksi hari yang sama",
    );
  }

  // Look up the system "Refund" expense category
  const [refundCat] = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(
      and(
        eq(expenseCategories.outletId, current.outletId),
        eq(expenseCategories.name, "Refund"),
        eq(expenseCategories.isSystem, true),
      ),
    )
    .limit(1);
  if (!refundCat) {
    return fail(
      "REFUND_CATEGORY_MISSING",
      "Kategori expense 'Refund' belum di-seed",
    );
  }

  const todayDate = todayWibYmd().replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");

  const { result, restoredIngredientIds } = await db.transaction(
    async (tx) => {
      const [updated] = await tx
        .update(transactions)
        .set({
          status: "refunded",
          refundedAt: new Date(),
          refundedBy: session.user.id,
          refundedApprover: approverId,
          refundReason: v.reason,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, v.transactionId))
        .returning();

      await tx.insert(expenses).values({
        outletId: current.outletId,
        expenseDate: todayDate,
        categoryId: refundCat.id,
        description: `Refund TRX ${current.transactionNumber}: ${v.reason}`,
        amount: current.total,
        paymentMethod: "cash",
        refundedTransactionId: current.id,
        createdBy: session.user.id,
      });

      const restored = await restoreStockForTransaction(
        tx,
        session.user.outletId,
        session.user.id,
        v.transactionId,
        "refund_restore",
      );

      return { result: updated, restoredIngredientIds: restored };
    },
  );

  if (restoredIngredientIds.length > 0) {
    reevaluateSoldOutForIngredients(restoredIngredientIds).catch((e) =>
      console.error("[sold-out re-eval refund]", e),
    );
  }

  await logAudit({
    eventType: "transaction.refund",
    userId: session.user.id,
    approverId,
    entityType: "transaction",
    entityId: result.id,
    payload: {
      summary: `Refund TRX ${result.transactionNumber} Rp${result.total.toLocaleString("id-ID")} (${v.reason})`,
      context: {
        transactionNumber: result.transactionNumber,
        total: result.total,
        paymentMethod: result.paymentMethod,
        reason: v.reason,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  return ok({ transaction: result });
}

// ---------- markServed ----------

export async function markServed(
  id: string,
): Promise<ApiResult<Transaction>> {
  await requireSession();
  const [row] = await db
    .update(transactions)
    .set({ servedAt: new Date(), updatedAt: new Date() })
    .where(eq(transactions.id, id))
    .returning();
  if (!row) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  return ok(row);
}

// ---------- Open Bills (saveAsOpenBill + closeOpenBill) ----------

/**
 * Save a transaction as an "open bill" — items locked, stock decremented as
 * usual, but no payment yet. Implementation wraps `createTransaction` with
 * placeholder payment fields that pass validation, then mutates the row to
 * status="open" + reset cashReceived/cashChange to 0.
 *
 * Workflow: kasir input order → tap "Simpan Bill" → trx persisted with
 * status="open" → customer leaves → returns later → kasir tap bill in
 * "Bill Aktif" tab → closeOpenBill processes payment + auto-prints struk.
 */
export async function saveAsOpenBill(
  input: SaveOpenBillInput,
): Promise<ApiResult<TransactionWithItems>> {
  const session = await requireSession();

  // Step 1: createTransaction with placeholder payment so validation passes
  // (cashReceived === total, cashChange === 0). Stock deduction + audit log
  // for discount fire as normal during this step.
  const placeholder: CreateTransactionInput = {
    clientRefId: input.clientRefId,
    shiftId: input.shiftId,
    cashierId: input.cashierId,
    pagerNumber: input.pagerNumber,
    orderType: input.orderType,
    items: input.items,
    subtotal: input.subtotal,
    discountType: input.discountType,
    discountValue: input.discountValue,
    discountAmount: input.discountAmount,
    discountReason: input.discountReason,
    total: input.total,
    paymentMethod: "cash",
    cashReceived: input.total,
    cashChange: 0,
    discountApproverToken: input.discountApproverToken,
  };
  const created = await createTransaction(placeholder);
  if (!isOk(created)) return created;

  // Step 2: flip to open status + reset payment fields. cashReceived stays
  // 0 (NOT NULL) to satisfy ck_transactions_cash_fields when payment_method
  // remains 'cash' as placeholder.
  const [updated] = await db
    .update(transactions)
    .set({
      status: "open",
      cashReceived: 0,
      cashChange: 0,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, created.data.id))
    .returning();

  await logAudit({
    eventType: "transaction.open_bill.create",
    userId: session.user.id,
    entityType: "transaction",
    entityId: created.data.id,
    payload: {
      summary: `Open bill ${created.data.transactionNumber} disimpan (Pager ${created.data.pagerNumber}, total Rp${created.data.total.toLocaleString("id-ID")})`,
      context: {
        transactionNumber: created.data.transactionNumber,
        total: created.data.total,
        itemCount: created.data.items.length,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  const refreshed = await fetchTransactionById(updated.id);
  return refreshed ? ok(refreshed) : ok({ ...created.data, status: "open" });
}

/**
 * Close an open bill — finalize the actual payment method + cash received,
 * transition status="open" → "paid". Caller (UI) is responsible for
 * triggering customer receipt auto-print after this returns ok.
 */
export async function closeOpenBill(
  input: CloseOpenBillInput,
): Promise<ApiResult<TransactionWithItems>> {
  const session = await requireSession();

  const current = await fetchTransactionById(input.transactionId);
  if (!current) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  if (current.status !== "open") {
    return fail(
      "BUSINESS_RULE_VIOLATION",
      `Hanya open bill yang bisa di-close (status saat ini: ${current.status})`,
    );
  }

  // Cash math validation
  if (input.paymentMethod === "cash") {
    if (input.cashReceived === null || input.cashReceived < current.total) {
      return fail(
        "INSUFFICIENT_CASH",
        `Tunai kurang. Total Rp${current.total.toLocaleString("id-ID")}.`,
      );
    }
  } else {
    if (input.cashReceived !== null) {
      return fail(
        "CASH_FIELDS_INVALID",
        "Non-cash tidak butuh cashReceived",
      );
    }
  }

  const cashChange =
    input.paymentMethod === "cash" && input.cashReceived !== null
      ? input.cashReceived - current.total
      : null;

  await db
    .update(transactions)
    .set({
      status: "paid",
      paymentMethod: input.paymentMethod,
      cashReceived: input.paymentMethod === "cash" ? input.cashReceived : null,
      cashChange:
        input.paymentMethod === "cash" ? cashChange : null,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, input.transactionId));

  await logAudit({
    eventType: "transaction.open_bill.close",
    userId: session.user.id,
    entityType: "transaction",
    entityId: input.transactionId,
    payload: {
      summary: `Close open bill ${current.transactionNumber} via ${input.paymentMethod} (Rp${current.total.toLocaleString("id-ID")})`,
      context: {
        transactionNumber: current.transactionNumber,
        paymentMethod: input.paymentMethod,
        total: current.total,
        cashReceived: input.cashReceived,
        cashChange,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  const refreshed = await fetchTransactionById(input.transactionId);
  return refreshed
    ? ok(refreshed)
    : fail("DB_ERROR", "Gagal fetch transaksi setelah close");
}
