"use server";

import { and, eq, getTableColumns, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  expenseCategories,
  expenses,
  menuItems,
  promos,
  promoUsages,
  shifts,
  transactionItemModifiers,
  transactionItems,
  transactions,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { consumeApproverToken } from "@/lib/auth/approver";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import {
  applyStockDeductions,
  computeStockFlowForOrder,
  reevaluateSoldOutForIngredients,
  restoreStockForTransaction,
} from "@/features/inventory/transaction-flow";
import {
  bumpCustomerRedeemInTx,
  computeRedemptionAmount,
  earnPointsForTransaction,
  findOrCreateCustomer,
} from "@/features/customers";
import {
  consumeApprovalCode,
  isOk as isApprovalOk,
  type ApprovalActionType,
} from "@/features/approval-codes";
import {
  fireJournalHook,
  postJournalForPosSale,
  postJournalForPosRefund,
} from "@/features/accounting/hooks";
import { isNull } from "drizzle-orm";
import { outlets, users } from "@/db/schema";
import { asc } from "drizzle-orm";

/**
 * Determine which approval mode applies for void/refund at this outlet.
 * Default "pin" so legacy ApproverOverrideModal stays the field-test path.
 * Owner flips to "code" via outlet settings when ready.
 */
async function resolveApprovalMode(
  outletId: string,
  kind: "void" | "refund",
): Promise<"pin" | "code"> {
  const [outlet] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, outletId))
    .limit(1);
  const approval = (outlet?.settings as
    | { approval?: { voidMode?: "pin" | "code"; refundMode?: "pin" | "code" } }
    | null)?.approval;
  const mode =
    kind === "void" ? approval?.voidMode : approval?.refundMode;
  return mode === "code" ? "code" : "pin";
}

/**
 * Resolve the active Owner user-id for code-mode approver attribution.
 * The Owner is who issued the email and forwarded the code; staff just
 * relays it. Returns null if no active Owner found (shouldn't happen).
 */
async function resolveActiveOwnerId(outletId: string): Promise<string | null> {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.outletId, outletId),
        eq(users.role, "owner"),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(asc(users.createdAt))
    .limit(1);
  return owner?.id ?? null;
}

/**
 * Authorize a void/refund based on outlet's approval mode. Returns the
 * `approverId` to record on the transaction + ok flag, or fails the
 * current action with a typed result.
 */
async function authorizeVoidRefund(
  outletId: string,
  transactionId: string,
  actionType: "pos.transaction.void" | "pos.transaction.refund",
  v: { approverToken?: string; approvalCode?: string },
): Promise<
  | { ok: true; approverId: string | null }
  | { ok: false; code: string; message: string }
> {
  const kind = actionType === "pos.transaction.void" ? "void" : "refund";
  const mode = await resolveApprovalMode(outletId, kind);
  if (mode === "code") {
    if (!v.approvalCode) {
      return {
        ok: false,
        code: "APPROVAL_CODE_REQUIRED",
        message: `${kind === "void" ? "Void" : "Refund"} butuh kode approval dari Owner`,
      };
    }
    const res = await consumeApprovalCode(transactionId, actionType, v.approvalCode);
    if (!isApprovalOk(res)) {
      return { ok: false, code: res.error.code, message: res.error.message };
    }
    const ownerId = await resolveActiveOwnerId(outletId);
    return { ok: true, approverId: ownerId };
  }
  // Legacy pin mode
  if (!v.approverToken) {
    return {
      ok: false,
      code: "APPROVER_REQUIRED",
      message: `${kind === "void" ? "Void" : "Refund"} butuh PIN approver`,
    };
  }
  try {
    const consumed = await consumeApproverToken(
      v.approverToken,
      actionType,
      transactionId,
    );
    return { ok: true, approverId: consumed.approverId };
  } catch (e) {
    return {
      ok: false,
      code: "APPROVER_TOKEN_INVALID",
      message: e instanceof Error ? e.message : "Token gagal",
    };
  }
}
import {
  fetchSplitBreakdown,
  fetchTransactionByClientRefId,
  fetchTransactionById,
  fetchTransactions,
  fetchTransactionsByIds,
  type ListTransactionsOptions,
} from "./queries";
import {
  addSplitPaymentSchema,
  cancelOpenBillSchema,
  createTransactionSchema,
  editOpenBillSchema,
  refundTransactionPartialSchema,
  refundTransactionSchema,
  voidTransactionSchema,
} from "./schemas";
import {
  refundEventItems,
  refundEvents,
  splitPaymentItems,
  splitPayments,
  transactionItems as transactionItemsSchema,
} from "@/db/schema";
import {
  computePartialRefund,
  nextStatusAfterRefund,
} from "./refund-pure";
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
  type AddSplitPaymentInput,
  type CancelOpenBillInput,
  type CloseOpenBillInput,
  type CreateTransactionInput,
  type EditOpenBillInput,
  type Paginated,
  type RefundTransactionInput,
  type RefundTransactionPartialInput,
  type SaveOpenBillInput,
  type SplitPaymentBreakdown,
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

/**
 * Block mutations on a transaction whose shift is already closed. Sesi Z #5:
 * Owner reported staff could refund/void/edit transactions belonging to a
 * tutup-kasir'd shift, which silently broke shift reconciliation totals.
 *
 * If the shift is missing we treat as not-found (defensive — should never
 * happen because trx.shift_id has FK).
 */
async function assertShiftOpen(
  shiftId: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const [row] = await db
    .select({ status: shifts.status })
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .limit(1);
  if (!row) {
    return { ok: false, code: "NOT_FOUND", message: "Shift tidak ditemukan" };
  }
  if (row.status === "closed") {
    return {
      ok: false,
      code: "SHIFT_CLOSED",
      message:
        "Shift sudah ditutup. Hubungi Owner untuk koreksi via Akuntansi → Manual Entry.",
    };
  }
  return { ok: true };
}

const BILL_NOTE_MAX = 200;

/** Trim + cap + normalize empty to null. Server boundary for `transactions.note`. */
function normalizeBillNote(input: string | null | undefined): string | null {
  if (input === undefined || input === null) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, BILL_NOTE_MAX);
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

/** Batch read for OpenBillPanel: 4 queries total instead of N×3-4 sequential.
 * Galih ask #7 — addresses "loading open bill lama". */
export async function getTransactionsByIds(
  ids: string[],
): Promise<ApiResult<TransactionWithItems[]>> {
  await requireSession();
  if (ids.length === 0) return ok([]);
  return ok(await fetchTransactionsByIds(ids));
}

// ---------- createTransaction ----------

export async function createTransaction(
  input: CreateTransactionInput,
  opts: { skipEarn?: boolean } = {},
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

  // Sesi AD-11 perf: PARALLEL pre-tx queries.
  // Was 4 sequential round-trips (idempotency → shift → menu → customer).
  // Each ~200-250ms RTT to Neon Singapore from Vercel iad1. Total ~1s.
  // Now: single Promise.all batch → max 1 RTT (slowest query).
  // Saves ~600-750ms on first paint of "Memvalidasi…" loading state.
  //
  // Plus: menu + categories combined into single LEFT JOIN query.
  const menuItemIds = Array.from(new Set(v.items.map((i) => i.menuItemId)));

  const [idempotentExisting, shift, menuRowsWithCat, customerResult] =
    await Promise.all([
      v.clientRefId
        ? fetchTransactionByClientRefId(v.clientRefId)
        : Promise.resolve(null),
      db
        .select()
        .from(shifts)
        .where(eq(shifts.id, v.shiftId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({
          ...getTableColumns(menuItems),
          categoryName: categories.name,
        })
        .from(menuItems)
        .leftJoin(categories, eq(menuItems.categoryId, categories.id))
        .where(inArray(menuItems.id, menuItemIds)),
      v.customerPhone
        ? findOrCreateCustomer({
            phone: v.customerPhone,
            name: v.customerName ?? `Member ${v.customerPhone}`,
          })
        : Promise.resolve(null),
    ]);

  // Idempotent hit — return early
  if (idempotentExisting) {
    const full = await fetchTransactionById(idempotentExisting.id);
    if (full) return ok(full);
  }

  // Shift validation
  if (!shift) return fail("SHIFT_NOT_FOUND", "Shift tidak ditemukan");
  if (shift.status !== "open") {
    return fail("SHIFT_CLOSED", "Shift sudah ditutup");
  }
  if (shift.userId !== session.user.id) {
    return fail("SHIFT_OWNERSHIP", "Shift bukan milik kamu");
  }

  // Approver token consumption — if discount applied AND user is staff.
  // NOT parallelized with the batch above because token consume is
  // destructive (decrements a counter) — we don't want to consume a token
  // if shift validation will fail.
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

  // Menu existence check
  if (menuRowsWithCat.length !== menuItemIds.length) {
    return fail("MENU_ITEM_NOT_FOUND", "Beberapa item tidak ditemukan");
  }

  // Build menu rows + category lookup from joined query result.
  // Strip the synthetic categoryName field for downstream MenuItem typing.
  const menuRows: MenuItem[] = menuRowsWithCat.map((row) => {
    const { categoryName: _omit, ...rest } = row;
    void _omit;
    return rest as MenuItem;
  });
  const categoryNameByMenuId = new Map<string, string>();
  for (const r of menuRowsWithCat) {
    categoryNameByMenuId.set(r.categoryId, r.categoryName ?? "");
  }
  const menuById = new Map(menuRows.map((m) => [m.id, m]));

  // Validate / recompute money server-side
  const validation = validateCreateTransaction(v, menuRows);
  if (!validation.ok) {
    return fail(validation.code, validation.message);
  }

  // Resolve customer result from parallel batch
  let customerId: string | null = null;
  let customerNameSnapshot = v.customerName ?? null;
  let resolvedCustomerBalance = 0;
  if (customerResult && customerResult.success) {
    customerId = customerResult.data.id;
    resolvedCustomerBalance = customerResult.data.totalPoints;
    // Use the canonical customer name from the loyalty record so the struk
    // and history reflect the registered name (kasir's free-text label
    // takes priority though if explicitly typed).
    if (!customerNameSnapshot) {
      customerNameSnapshot = customerResult.data.name;
    }
  }
  // If find-or-create failed (e.g. invalid phone), silently continue
  // without loyalty linkage — sale must not block on this.

  // Loyalty redemption pre-flight. The actual balance decrement happens
  // inside the sale tx (atomic with the insert) so a rollback also
  // rolls back the deduction. Here we only sanity-check the request shape
  // matches the discount slot the client populated.
  const redeemPoints = v.loyaltyPointsRedeemed ?? 0;
  if (redeemPoints > 0) {
    if (customerId === null) {
      return fail(
        "REDEEM_NO_CUSTOMER",
        "Tukar poin butuh nomor HP member yang valid",
      );
    }
    if (redeemPoints > resolvedCustomerBalance) {
      return fail(
        "REDEEM_BALANCE_INSUFFICIENT",
        `Saldo poin tidak cukup (saldo ${resolvedCustomerBalance}, diminta ${redeemPoints})`,
      );
    }
    const expectedRupiah = computeRedemptionAmount(redeemPoints);
    if (validation.recomputedDiscountAmount !== expectedRupiah) {
      return fail(
        "REDEEM_DISCOUNT_MISMATCH",
        `Discount amount tidak match (expected ${expectedRupiah}, got ${validation.recomputedDiscountAmount})`,
      );
    }
    if (!(v.discountReason ?? "").startsWith("Tukar Poin:")) {
      return fail(
        "REDEEM_REASON_REQUIRED",
        "Discount reason harus dimulai 'Tukar Poin:' saat redemption",
      );
    }
  }

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
          customerName: customerNameSnapshot,
          note: normalizeBillNote(v.note),
          customerId,
          loyaltyPointsRedeemed: redeemPoints > 0 ? redeemPoints : null,
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
          promoId: v.promoId ?? null,
        })
        .returning();

      // Sesi K — when discount sourced from a master promo, record the
      // usage + bump currentUses. Both inside the same DB tx so a rollback
      // (e.g. stock failure later) also rolls back the usage row.
      if (v.promoId && validation.recomputedDiscountAmount > 0) {
        await tx.insert(promoUsages).values({
          promoId: v.promoId,
          transactionId: insertedTrx.id,
          outletId: session.user.outletId,
          discountAmount: validation.recomputedDiscountAmount,
          appliedBy: session.user.id,
          approverId: discountApproverId,
        });
        await tx
          .update(promos)
          .set({
            currentUses: sql`${promos.currentUses} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(promos.id, v.promoId));
      }

      // Loyalty redemption — decrement member balance atomically with the
      // sale. Helper throws INSUFFICIENT_POINTS_RACE if a concurrent
      // redemption drove the balance below 0; the throw rolls back the
      // entire sale tx (insert + items + stock movements) cleanly.
      let memberAfterRedeem: { id: string; totalPoints: number; name: string; phone: string } | null = null;
      if (redeemPoints > 0 && customerId !== null) {
        memberAfterRedeem = await bumpCustomerRedeemInTx(
          tx,
          customerId,
          redeemPoints,
          session.user.id,
        );
      }

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

      // Patch each transaction_item.cogs that has a resolved recipe.
      // Galih ask #8: paralel via Promise.all so N items aren't sequential
      // round-trips inside the tx (was a noticeable chunk of payment latency).
      const cogsPatches = itemsInserted
        .map((ti) => ({ id: ti.id, cogs: flow.itemCogsByTrxItemId.get(ti.id) }))
        .filter(
          (p): p is { id: string; cogs: number } =>
            p.cogs !== undefined && p.cogs > 0,
        );
      if (cogsPatches.length > 0) {
        await Promise.all(
          cogsPatches.map((p) =>
            tx
              .update(transactionItems)
              .set({ cogs: p.cogs })
              .where(eq(transactionItems.id, p.id)),
          ),
        );
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
        memberAfterRedeem,
      };
    });

    // Best-effort sold-out re-eval after main tx commits.
    if (result.deductedIngredientIds.length > 0) {
      reevaluateSoldOutForIngredients(result.deductedIngredientIds).catch(
        (e) => console.error("[sold-out re-eval]", e),
      );
    }

    // Galih ask #8: audit logs run best-effort post-commit so the
    // server response isn't gated on extra DB round-trips. Both events
    // are advisory (reports + compliance) and tolerant to brief delay.
    if (validation.recomputedDiscountAmount > 0) {
      // Compliment is implemented as a 100% discount with reason prefixed
      // "Compliment: ". Audit event differentiated so reports + compliance
      // can filter complimented transactions distinctly from regular promo
      // discounts.
      const isCompliment = (v.discountReason ?? "").startsWith("Compliment:");
      logAudit({
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
      }).catch((e) => console.error("[audit discount]", e));
    }

    // Loyalty redemption audit — emitted after the sale tx commits since
    // the deduction was atomic with the insert. Records the count of
    // points spent + new member balance for compliance/abuse monitoring.
    if (redeemPoints > 0 && result.memberAfterRedeem) {
      logAudit({
        eventType: "transaction.points.redeemed",
        userId: session.user.id,
        entityType: "transaction",
        entityId: result.trx.id,
        payload: {
          summary: `-${redeemPoints} poin pada TRX ${result.trx.transactionNumber} (Rp${computeRedemptionAmount(redeemPoints).toLocaleString("id-ID")} discount)`,
          context: {
            transactionNumber: result.trx.transactionNumber,
            customerId: customerId,
            pointsRedeemed: redeemPoints,
            rupiahRedeemed: computeRedemptionAmount(redeemPoints),
            memberBalanceAfter: result.memberAfterRedeem.totalPoints,
            memberPhone: result.memberAfterRedeem.phone,
          },
        },
        metadata: {
          outletId: session.user.outletId,
          actorRole: session.user.role,
        },
      }).catch((e) => console.error("[audit redeem]", e));
    }

    // Loyalty earn — best-effort, fired after the sale tx commits. Skipped
    // when called from saveAsOpenBill (status will be flipped to "open"
    // before the bill is paid; closeOpenBill fires earn later).
    if (!opts.skipEarn && customerId !== null) {
      earnPointsForTransaction(result.trx.id).catch((e) =>
        console.error("[loyalty earn]", e),
      );
    }

    // Sesi T — Accounting auto-journal hook (fire-and-forget, feature-flagged).
    // Skipped when saveAsOpenBill calls (status flipped to 'open' before paid).
    // sesi AD-11: hoisted dynamic import to top of file to skip ~5-10ms
    // module load on every paid transaction.
    if (!opts.skipEarn && result.trx.status === "paid") {
      fireJournalHook(
        () =>
          postJournalForPosSale({
            outletId: session.user.outletId,
            transactionId: result.trx.id,
            actorId: session.user.id,
          }),
        "pos_sale",
      );
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
    // Concurrent redemption race — bumpCustomerRedeemInTx threw because the
    // tx-internal balance went negative. Surface a clean kasir-actionable
    // error instead of generic DB_ERROR.
    if (e instanceof Error && e.message === "INSUFFICIENT_POINTS_RACE") {
      return fail(
        "REDEEM_BALANCE_RACE",
        "Saldo poin member berubah saat checkout. Coba ulang dengan jumlah lebih kecil.",
      );
    }
    return fail("DB_ERROR", logAndSanitize(e, "transactions", "Operasi database gagal"));
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

  // Authorization: outlet flag picks PIN-mode (legacy ApproverOverrideModal,
  // Owner+Manager) or code-mode (Owner-only via emailed 6-digit). Anyone with
  // request perm can call; the helper returns approverId or a failure.
  // RBAC pre-check: in PIN mode, current pos.transaction.void perm gates;
  // in code mode, the .request perm gates initiation (already enforced when
  // requestApprovalCode was called). Either path produces a valid token/code
  // pre-call here; we just need the user to have *some* role.
  const auth_ = await authorizeVoidRefund(
    session.user.outletId,
    v.transactionId,
    "pos.transaction.void",
    v,
  );
  if (!auth_.ok) {
    return fail(auth_.code, auth_.message);
  }
  const approverId = auth_.approverId;

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
  const shiftCheck = await assertShiftOpen(current.shiftId);
  if (!shiftCheck.ok) return fail(shiftCheck.code, shiftCheck.message);

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

    // Sesi AE-62i — restore loyalty points for void.
    const { restorePointsOnTransactionRefund } = await import(
      "@/features/customers/actions"
    );
    await restorePointsOnTransactionRefund(tx, v.transactionId, {
      refundKind: "void",
      actorId: session.user.id,
    });

    // Sesi AE-62i — decrement promo.currentUses untuk void.
    const promoUsageRows = await tx
      .select({ id: promoUsages.id, promoId: promoUsages.promoId })
      .from(promoUsages)
      .where(eq(promoUsages.transactionId, v.transactionId));
    for (const u of promoUsageRows) {
      await tx
        .update(promos)
        .set({
          currentUses: sql`GREATEST(0, ${promos.currentUses} - 1)`,
          updatedAt: new Date(),
        })
        .where(eq(promos.id, u.promoId));
    }

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

  // Sesi AE-62j — fire reverse journal hook untuk void. Sebelumnya void
  // commit transaction status update + restore stock/points/promo, tapi
  // TIDAK fire journal hook → GL drift permanent (sale-time journal Dr Kas
  // Cr Revenue tetap, void cuma flip flag). Sekarang post pos_void reverse
  // dengan items (untuk reverse COGS).
  {
    const { postJournalForPosVoid } = await import(
      "@/features/accounting/hooks"
    );
    const itemRows = await db
      .select({
        itemCategoryName: transactionItemsSchema.itemCategoryName,
        subtotal: transactionItemsSchema.subtotal,
        cogs: transactionItemsSchema.cogs,
      })
      .from(transactionItemsSchema)
      .where(eq(transactionItemsSchema.transactionId, v.transactionId));
    const aggItems = itemRows.map((it) => ({
      itemCategoryName: it.itemCategoryName,
      amount: Number(it.subtotal),
      cogs: Number(it.cogs ?? 0),
    }));
    fireJournalHook(
      () =>
        postJournalForPosVoid({
          outletId: session.user.outletId,
          transactionId: v.transactionId,
          items: aggItems,
          actorId: session.user.id,
        }),
      "pos_void",
    );
  }

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

  // Authorization: outlet flag picks PIN-mode or code-mode. See helper.
  const auth_ = await authorizeVoidRefund(
    session.user.outletId,
    v.transactionId,
    "pos.transaction.refund",
    v,
  );
  if (!auth_.ok) {
    return fail(auth_.code, auth_.message);
  }
  const approverId = auth_.approverId;

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
  const shiftCheck = await assertShiftOpen(current.shiftId);
  if (!shiftCheck.ok) return fail(shiftCheck.code, shiftCheck.message);

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
          refundedAmount: current.total,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, v.transactionId))
        .returning();

      // Mirror refund event in the immutable log + mark all transaction
      // items as fully refunded so partial refund can never re-charge them.
      const [evt] = await tx
        .insert(refundEvents)
        .values({
          transactionId: v.transactionId,
          outletId: current.outletId,
          kind: "full",
          totalRefunded: current.total,
          reason: v.reason,
          createdByUserId: session.user.id,
          approverUserId: approverId,
        })
        .returning();

      const trxItems = await tx
        .select()
        .from(transactionItemsSchema)
        .where(eq(transactionItemsSchema.transactionId, v.transactionId));
      if (trxItems.length > 0) {
        await tx.insert(refundEventItems).values(
          trxItems.map((it) => ({
            refundEventId: evt.id,
            transactionItemId: it.id,
            quantityRefunded: it.quantity - it.refundedQuantity,
            amountRefunded: it.subtotal - it.refundedAmount,
          })),
        );
        for (const it of trxItems) {
          await tx
            .update(transactionItemsSchema)
            .set({
              refundedQuantity: it.quantity,
              refundedAmount: it.subtotal,
            })
            .where(eq(transactionItemsSchema.id, it.id));
        }
      }

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

      // Sesi AE-62i — restore loyalty points (claw-back earned + re-credit
      // redeemed). Sebelumnya silent skip → loyalty ratchet bug.
      const { restorePointsOnTransactionRefund } = await import(
        "@/features/customers/actions"
      );
      await restorePointsOnTransactionRefund(tx, v.transactionId, {
        refundKind: "full",
        actorId: session.user.id,
      });

      // Sesi AE-62i — decrement promo.currentUses kalau trx pakai promo.
      // Sebelumnya: refunded trx tetap counted di maxTotalUses → promo
      // "100 use" actually unusable kalau 100 trx (30 refunded) sudah hit.
      const promoUsageRows = await tx
        .select({ id: promoUsages.id, promoId: promoUsages.promoId })
        .from(promoUsages)
        .where(eq(promoUsages.transactionId, v.transactionId));
      for (const u of promoUsageRows) {
        await tx
          .update(promos)
          .set({
            currentUses: sql`GREATEST(0, ${promos.currentUses} - 1)`,
            updatedAt: new Date(),
          })
          .where(eq(promos.id, u.promoId));
      }

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

  // Sesi T — Accounting auto-journal (full refund). Source id = transaction.id
  // (full refund happens once per transaction max). Partial refunds use a
  // separate sourceType + refund_event_id (see refundTransactionPartial).
  // sesi AD-11: hoisted to static import.
  // Sesi AE-62j — pass items supaya COGS + Persediaan ter-reverse di GL.
  // Sebelumnya items=undefined → mapPosRefund skip COGS reversal →
  // Persediaan GL permanently overstated by refund amount.
  {
    const itemRows = await db
      .select({
        itemCategoryName: transactionItemsSchema.itemCategoryName,
        subtotal: transactionItemsSchema.subtotal,
        cogs: transactionItemsSchema.cogs,
      })
      .from(transactionItemsSchema)
      .where(eq(transactionItemsSchema.transactionId, result.id));
    const aggItems = itemRows.map((it) => ({
      itemCategoryName: it.itemCategoryName,
      amount: Number(it.subtotal),
      cogs: Number(it.cogs ?? 0),
    }));
    fireJournalHook(
      () =>
        postJournalForPosRefund({
          outletId: session.user.outletId,
          transactionId: result.id,
          refundEventId: result.id, // full-refund: 1:1 ke transaction
          refundedAmount: result.total,
          items: aggItems,
          reverseCogs: true,
          actorId: session.user.id,
        }),
      "pos_refund_full",
    );
  }

  return ok({ transaction: result });
}

// ---------- refundTransactionPartial ----------

/**
 * Refund a subset of items from a paid transaction. Same eligibility rules
 * as full refund (cash + same-day). Computes pro-rata refund amount, writes
 * a refund_events log row + per-item lines, updates transaction_items
 * cumulative refunded fields, bumps transactions.refunded_amount, and flips
 * status → partially_refunded (or refunded if cumulative reaches total).
 *
 * NOTE: stock restoration for partial refunds is intentionally NOT done in
 * v1 (full refund still restores). Owner can manually adjust ingredients
 * via Admin → Inventory if needed. Trade-off for ship simplicity; can be
 * added later by extending restoreStockForTransaction with itemFilter.
 */
export async function refundTransactionPartial(
  input: RefundTransactionPartialInput,
): Promise<ApiResult<{ transaction: Transaction; eventId: string }>> {
  const session = await requireSession();

  const parsed = refundTransactionPartialSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const auth_ = await authorizeVoidRefund(
    session.user.outletId,
    v.transactionId,
    "pos.transaction.refund",
    v,
  );
  if (!auth_.ok) {
    return fail(auth_.code, auth_.message);
  }
  const approverId = auth_.approverId;

  const [current] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, v.transactionId))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  if (current.status !== "paid" && current.status !== "partially_refunded") {
    return fail(
      "BUSINESS_RULE_VIOLATION",
      "Hanya transaksi paid / partially_refunded yang bisa di-refund parsial",
    );
  }
  if (current.paymentMethod !== "cash") {
    return fail(
      "REFUND_NOT_ALLOWED_NON_CASH",
      "Phase 1: hanya cash yang bisa di-refund",
    );
  }
  const shiftCheck = await assertShiftOpen(current.shiftId);
  if (!shiftCheck.ok) return fail(shiftCheck.code, shiftCheck.message);

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

  // Snapshot current item state for pure-helper validation + computation
  const trxItems = await db
    .select()
    .from(transactionItemsSchema)
    .where(eq(transactionItemsSchema.transactionId, v.transactionId));

  const computation = computePartialRefund(
    v.items,
    trxItems.map((it) => ({
      transactionItemId: it.id,
      quantity: it.quantity,
      refundedQuantity: it.refundedQuantity,
      subtotal: it.subtotal,
    })),
    current.subtotal,
    current.discountAmount,
    current.refundedAmount,
    current.total,
  );

  if (!computation.ok) {
    return fail(
      computation.errorCode ?? "VALIDATION_ERROR",
      computation.errorMessage ?? "Input refund tidak valid",
    );
  }

  const todayDate = todayWibYmd().replace(
    /(\d{4})(\d{2})(\d{2})/,
    "$1-$2-$3",
  );
  const newCumulative = current.refundedAmount + computation.totalRefunded;
  const nextStatus = nextStatusAfterRefund(newCumulative, current.total);

  const result = await db.transaction(async (tx) => {
    // Insert refund event
    const [evt] = await tx
      .insert(refundEvents)
      .values({
        transactionId: v.transactionId,
        outletId: current.outletId,
        kind: "partial",
        totalRefunded: computation.totalRefunded,
        reason: v.reason,
        createdByUserId: session.user.id,
        approverUserId: approverId,
      })
      .returning();

    // Insert per-item lines
    await tx.insert(refundEventItems).values(
      computation.perItem.map((p) => ({
        refundEventId: evt.id,
        transactionItemId: p.transactionItemId,
        quantityRefunded: p.quantityRefunded,
        amountRefunded: p.amountRefunded,
      })),
    );

    // Bump per-item cumulative
    for (const p of computation.perItem) {
      await tx
        .update(transactionItemsSchema)
        .set({
          refundedQuantity: sql`${transactionItemsSchema.refundedQuantity} + ${p.quantityRefunded}`,
          refundedAmount: sql`${transactionItemsSchema.refundedAmount} + ${p.amountRefunded}`,
        })
        .where(eq(transactionItemsSchema.id, p.transactionItemId));
    }

    // Bump transaction cumulative + flip status
    const updateSet: Record<string, unknown> = {
      refundedAmount: newCumulative,
      updatedAt: new Date(),
    };
    if (nextStatus === "refunded") {
      // Final closure — also fill the legacy parent fields for the existing
      // refundTransaction-style flow, so reports that rely on these still
      // work. Status flip will hide the trx from "paid" filters.
      updateSet.status = "refunded";
      updateSet.refundedAt = new Date();
      updateSet.refundedBy = session.user.id;
      updateSet.refundedApprover = approverId;
      updateSet.refundReason = `Partial refund cumulative — last reason: ${v.reason}`;
    } else {
      updateSet.status = "partially_refunded";
    }

    const [updated] = await tx
      .update(transactions)
      .set(updateSet)
      .where(eq(transactions.id, v.transactionId))
      .returning();

    // Cash expense entry mirroring the partial refund amount
    await tx.insert(expenses).values({
      outletId: current.outletId,
      expenseDate: todayDate,
      categoryId: refundCat.id,
      description: `Refund parsial TRX ${current.transactionNumber}: ${v.reason}`,
      amount: computation.totalRefunded,
      paymentMethod: "cash",
      refundedTransactionId: current.id,
      createdBy: session.user.id,
    });

    // Sesi AE-62i — pro-rate claw-back earned points sesuai refund share.
    // Kalau partial bertahap → tiap event clawback proportional. Kalau
    // cumulative reach total (nextStatus='refunded') → full clawback +
    // restore redeemed.
    const { restorePointsOnTransactionRefund } = await import(
      "@/features/customers/actions"
    );
    if (nextStatus === "refunded") {
      await restorePointsOnTransactionRefund(tx, v.transactionId, {
        refundKind: "full",
        actorId: session.user.id,
      });
    } else {
      await restorePointsOnTransactionRefund(tx, v.transactionId, {
        refundKind: "partial",
        refundAmount: computation.totalRefunded,
        actorId: session.user.id,
      });
    }

    return { transaction: updated, eventId: evt.id };
  });

  await logAudit({
    eventType: "transaction.refund.partial",
    userId: session.user.id,
    approverId,
    entityType: "transaction",
    entityId: result.transaction.id,
    payload: {
      summary: `Refund parsial TRX ${result.transaction.transactionNumber} Rp${computation.totalRefunded.toLocaleString("id-ID")} (${v.reason})`,
      context: {
        transactionNumber: result.transaction.transactionNumber,
        eventId: result.eventId,
        totalRefunded: computation.totalRefunded,
        cumulativeRefunded: newCumulative,
        transactionTotal: result.transaction.total,
        nextStatus,
        items: computation.perItem,
        reason: v.reason,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  // Sesi AE-62g — partial refund harus fire journal hook juga (sebelumnya
  // cuma full refund yang fire → GL drift = under-record refund expense).
  // sourceId = refund_event.id supaya idempotent per partial refund event.
  // Sesi AE-62j — pass per-item COGS pro-rated by amountRefunded supaya
  // Persediaan GL ter-reverse proporsional ke refund value.
  {
    const itemRows = await db
      .select({
        id: transactionItemsSchema.id,
        itemCategoryName: transactionItemsSchema.itemCategoryName,
        subtotal: transactionItemsSchema.subtotal,
        cogs: transactionItemsSchema.cogs,
        quantity: transactionItemsSchema.quantity,
      })
      .from(transactionItemsSchema)
      .where(eq(transactionItemsSchema.transactionId, result.transaction.id));
    // Build map id → per-item COGS-per-unit.
    const costByItemId = new Map<string, { cat: string; cogsPerUnit: number; pricePerUnit: number; qty: number }>();
    for (const it of itemRows) {
      costByItemId.set(it.id, {
        cat: it.itemCategoryName,
        cogsPerUnit: it.quantity > 0 ? Number(it.cogs ?? 0) / it.quantity : 0,
        pricePerUnit: it.quantity > 0 ? Number(it.subtotal) / it.quantity : 0,
        qty: it.quantity,
      });
    }
    // computation.perItem berisi quantityRefunded + amountRefunded per item.
    // Aggregate by category untuk feed mapPosRefund.
    const aggMap = new Map<string, { amount: number; cogs: number }>();
    for (const p of computation.perItem) {
      const meta = costByItemId.get(p.transactionItemId);
      if (!meta) continue;
      const cur = aggMap.get(meta.cat) ?? { amount: 0, cogs: 0 };
      cur.amount += p.amountRefunded;
      cur.cogs += Math.round(meta.cogsPerUnit * p.quantityRefunded);
      aggMap.set(meta.cat, cur);
    }
    const aggItems = Array.from(aggMap.entries()).map(([cat, v]) => ({
      itemCategoryName: cat,
      amount: v.amount,
      cogs: v.cogs,
    }));
    fireJournalHook(
      () =>
        postJournalForPosRefund({
          outletId: session.user.outletId,
          transactionId: result.transaction.id,
          refundEventId: result.eventId,
          refundedAmount: computation.totalRefunded,
          items: aggItems,
          reverseCogs: true,
          actorId: session.user.id,
        }),
      "pos_refund_partial",
    );
  }

  return ok({ transaction: result.transaction, eventId: result.eventId });
}

// ---------- updateItemPrepStatus (KDS sesi AE-35) ----------

/**
 * Update prep_status untuk single transaction item (Pesanan tab KDS).
 * Transitions:
 *   pending → in_progress   (staff start preparing)
 *   in_progress → done      (staff selesai)
 *   any → pending           (reset, undo)
 *
 * Stamps prep_started_at saat masuk in_progress, prep_done_at saat done.
 * Same permission dgn markServed (pos.transaction.create) — staff &
 * kasir bisa update status persiapan.
 */
export async function updateItemPrepStatus(input: {
  itemId: string;
  status: "pending" | "in_progress" | "done";
}): Promise<ApiResult<{ id: string; prepStatus: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pos.transaction.create")) {
    return fail("FORBIDDEN", "Tidak punya hak update status pesanan");
  }
  const now = new Date();
  const updates: {
    prepStatus: "pending" | "in_progress" | "done";
    prepStartedAt?: Date | null;
    prepDoneAt?: Date | null;
  } = { prepStatus: input.status };
  if (input.status === "in_progress") {
    updates.prepStartedAt = now;
    updates.prepDoneAt = null;
  } else if (input.status === "done") {
    updates.prepDoneAt = now;
  } else {
    // reset to pending — clear both timestamps
    updates.prepStartedAt = null;
    updates.prepDoneAt = null;
  }

  // Outlet boundary via JOIN check.
  // Sesi AE-62l — race guard: 2 staff klik "Done" same item paralel both
  // succeed (overwrite timestamps). Add WHERE prep_status != new status
  // supaya kalau sudah di-update by kasir lain, UPDATE no-op (return empty).
  // Client side optimistic UI tetap show updated state, server sync di
  // next refresh tick.
  const [row] = await db
    .update(transactionItems)
    .set(updates)
    .where(
      and(
        eq(transactionItems.id, input.itemId),
        sql`${transactionItems.prepStatus} != ${input.status}`,
        sql`EXISTS (
          SELECT 1 FROM ${transactions} t
          WHERE t.id = ${transactionItems.transactionId}
            AND t.outlet_id = ${session.user.outletId}
        )`,
      ),
    )
    .returning({ id: transactionItems.id, prepStatus: transactionItems.prepStatus });
  if (!row) {
    // Check apakah memang sudah ke-update by another staff (idempotent OK)
    // atau item benar-benar gak ada.
    const [existing] = await db
      .select({ id: transactionItems.id, prepStatus: transactionItems.prepStatus })
      .from(transactionItems)
      .where(eq(transactionItems.id, input.itemId))
      .limit(1);
    if (existing) {
      // Already at target state (or different state set by concurrent kasir).
      return ok(existing);
    }
    return fail("NOT_FOUND", "Item tidak ditemukan");
  }
  return ok(row);
}

/** Bulk: tandai SEMUA item dari 1 transaksi sebagai done.
 *  Tombol "Tandai Semua Selesai" di OrderCard (KDS). */
export async function markAllItemsDone(
  transactionId: string,
): Promise<ApiResult<{ updatedCount: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pos.transaction.create")) {
    return fail("FORBIDDEN", "Tidak punya hak update status");
  }
  const now = new Date();
  const rows = await db
    .update(transactionItems)
    .set({
      prepStatus: "done",
      prepDoneAt: now,
      prepStartedAt: sql`COALESCE(${transactionItems.prepStartedAt}, ${now})`,
    })
    .where(
      and(
        eq(transactionItems.transactionId, transactionId),
        sql`${transactionItems.prepStatus} != 'done'`,
        sql`EXISTS (
          SELECT 1 FROM ${transactions} t
          WHERE t.id = ${transactionId}
            AND t.outlet_id = ${session.user.outletId}
        )`,
      ),
    )
    .returning({ id: transactionItems.id });
  return ok({ updatedCount: rows.length });
}

// ---------- markServed ----------

/**
 * Mark transaction as served (food/drink delivered ke pelanggan). Idempotent.
 * Sesi AC-5b hardening (ramaactivity/code-review): sebelumnya tidak ada
 * outlet boundary check + tidak ada permission check + bisa markServed
 * voided/refunded transaksi. UPDATE WHERE id=? tanpa outletId →
 * cross-outlet bleed risk.
 */
export async function markServed(
  id: string,
): Promise<ApiResult<Transaction>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pos.transaction.create")) {
    return fail("FORBIDDEN", "Tidak punya hak mark served");
  }

  // Atomic UPDATE with outlet boundary + status guard.
  // Only paid/open transactions are servable; voided/refunded irrelevant.
  const [row] = await db
    .update(transactions)
    .set({ servedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(transactions.id, id),
        eq(transactions.outletId, session.user.outletId),
        inArray(transactions.status, ["paid", "open"]),
      ),
    )
    .returning();
  if (!row) {
    return fail(
      "NOT_FOUND",
      "Transaksi tidak ditemukan atau status tidak valid",
    );
  }
  return ok(row);
}

// ---------- editOpenBill ----------

/**
 * Replace items + recompute totals on an existing open bill. Status remains
 * "open"; payment fields untouched. Stock for old items is restored
 * (kind=edit_restore movements), then re-deducted for the new items via the
 * normal flow.
 *
 * Used when kasir notices a typo or customer changes mind before paying.
 * Galih ask #6 — fixes the "items locked once saved" friction.
 */
export async function editOpenBill(
  input: EditOpenBillInput,
): Promise<ApiResult<TransactionWithItems>> {
  const session = await requireSession();

  const parsed = editOpenBillSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  /* Sesi AE-48 — same rule: nama pemilik bill wajib (sama dengan
   * saveAsOpenBill). Edit tidak boleh hapus nama. */
  const editCustomerNameTrimmed = v.customerName?.trim() ?? "";
  if (editCustomerNameTrimmed.length === 0) {
    return fail(
      "CUSTOMER_NAME_REQUIRED",
      "Nama pemilik bill wajib diisi. Edit bill tidak boleh menghilangkan nama.",
    );
  }

  const current = await fetchTransactionById(v.transactionId);
  if (!current) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  if (current.status !== "open") {
    return fail(
      "BUSINESS_RULE_VIOLATION",
      `Hanya open bill yang bisa di-edit (status saat ini: ${current.status})`,
    );
  }
  const shiftCheck = await assertShiftOpen(current.shiftId);
  if (!shiftCheck.ok) return fail(shiftCheck.code, shiftCheck.message);

  // Sesi AE-62k — defer approver token consumption sampai sebelum tx.
  // Sebelumnya: token di-consume sebelum validasi & lock check → kalau
  // edit gagal di tx (mis. stock error, race), approver token sudah burnt
  // tapi edit tidak applied → staff harus minta approver token baru +
  // audit log shows token consumed without effect.
  //
  // Permission check tetap di sini (cheap), token consumption deferred.
  if (v.discountAmount > 0 && session.user.role === "staff") {
    if (!v.discountApproverToken) {
      return fail(
        "APPROVER_REQUIRED",
        "Staff butuh approver untuk apply discount",
      );
    }
  }
  if (v.discountAmount > 0 && session.user.role !== "staff") {
    if (!hasPermission(session.user.role, "pos.discount.apply")) {
      return fail("FORBIDDEN", "Tidak punya hak apply discount");
    }
  }

  // Fetch all referenced menu items
  const menuItemIds = Array.from(new Set(v.items.map((i) => i.menuItemId)));
  const menuRows: MenuItem[] = await db
    .select()
    .from(menuItems)
    .where(inArray(menuItems.id, menuItemIds));
  if (menuRows.length !== menuItemIds.length) {
    return fail("MENU_ITEM_NOT_FOUND", "Beberapa item tidak ditemukan");
  }

  // Reuse validateCreateTransaction by synthesising payment fields with
  // placeholder cash values that satisfy the cash-validation branch.
  const synthetic: CreateTransactionInput = {
    shiftId: current.shiftId,
    cashierId: session.user.id,
    pagerNumber: current.pagerNumber,
    orderType: current.orderType,
    customerName: v.customerName,
    items: v.items,
    subtotal: v.subtotal,
    discountType: v.discountType,
    discountValue: v.discountValue,
    discountAmount: v.discountAmount,
    discountReason: v.discountReason,
    total: v.total,
    paymentMethod: "cash",
    cashReceived: v.total,
    cashChange: 0,
  };
  const validation = validateCreateTransaction(synthetic, menuRows);
  if (!validation.ok) {
    return fail(validation.code, validation.message);
  }

  const categoryNameByMenuId = new Map<string, string>();
  {
    const catIds = Array.from(new Set(menuRows.map((m) => m.categoryId)));
    const cats = await db
      .select({ id: sql<string>`id`, name: sql<string>`name` })
      .from(sql`categories`)
      .where(sql`id in ${catIds}`);
    for (const c of cats) categoryNameByMenuId.set(c.id, c.name);
  }
  const menuById = new Map(menuRows.map((m) => [m.id, m]));

  // Re-resolve loyalty linkage on edit. New phone → relink to that member.
  // Empty phone → preserve existing linkage (kasir can't accidentally
  // un-link by leaving the field blank). To explicitly remove a member
  // the Owner uses Admin → Customers.
  let customerId: string | null = current.customerId;
  // Sesi AE-48 — pakai trimmed value supaya whitespace tidak lolos ke DB.
  let customerNameSnapshot = editCustomerNameTrimmed;
  if (v.customerPhone) {
    const customerRes = await findOrCreateCustomer({
      phone: v.customerPhone,
      name: v.customerName ?? `Member ${v.customerPhone}`,
    });
    if (customerRes.success) {
      customerId = customerRes.data.id;
      if (!v.customerName) {
        customerNameSnapshot = customerRes.data.name;
      }
    }
  }

  let discountApproverId: string | null = null;
  try {
    const result = await db.transaction(async (tx) => {
      // Sesi AE-62k — SELECT FOR UPDATE pada transaction parent dulu untuk
      // prevent concurrent edit. Sebelumnya: 2 kasir edit same bill paralel,
      // both delete same items, both insert different items → first edit's
      // items hilang silently. Sekarang serialize.
      const [locked] = await tx
        .select({ id: transactions.id, status: transactions.status })
        .from(transactions)
        .where(eq(transactions.id, v.transactionId))
        .for("update")
        .limit(1);
      if (!locked) throw new Error("NOT_FOUND");
      if (locked.status !== "open") throw new Error("TRX_NOT_OPEN");

      // Sesi AE-62k — consume approver token INSIDE tx supaya kalau tx
      // rollback (any failure), token tidak ke-consume orphan. Postgres
      // tx-scoped consumeApproverToken: token marked used hanya saat commit.
      if (v.discountAmount > 0 && session.user.role === "staff") {
        try {
          const consumed = await consumeApproverToken(
            v.discountApproverToken!,
            "pos.discount.apply",
            null,
          );
          discountApproverId = consumed.approverId;
        } catch (e) {
          throw new Error(
            `APPROVER_TOKEN_INVALID:${e instanceof Error ? e.message : "Token gagal"}`,
          );
        }
      }

      // Step 1: restore stock for the existing items (mirrors void semantics
      // but uses kind=edit_restore so movement history is filterable).
      await restoreStockForTransaction(
        tx,
        session.user.outletId,
        session.user.id,
        v.transactionId,
        "edit_restore",
      );

      // Step 2: delete existing modifiers + items. Modifiers FK has no
      // ON DELETE CASCADE so we have to drop them first.
      const existingItemRows = await tx
        .select({ id: transactionItems.id })
        .from(transactionItems)
        .where(eq(transactionItems.transactionId, v.transactionId));
      const existingItemIds = existingItemRows.map((r) => r.id);
      if (existingItemIds.length > 0) {
        await tx
          .delete(transactionItemModifiers)
          .where(
            inArray(transactionItemModifiers.transactionItemId, existingItemIds),
          );
        await tx
          .delete(transactionItems)
          .where(eq(transactionItems.transactionId, v.transactionId));
      }

      // Step 3: insert new items.
      const itemsInserted = await tx
        .insert(transactionItems)
        .values(
          v.items.map((it) => {
            const menu = menuById.get(it.menuItemId)!;
            return {
              transactionId: v.transactionId,
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

      // Step 4: compute new flow + apply deductions.
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

      const hasAnyCogs = flow.itemsWithoutRecipe.length < v.items.length;

      // Step 5: patch transaction header.
      await tx
        .update(transactions)
        .set({
          subtotal: validation.recomputedSubtotal,
          discountType: v.discountType,
          discountValue: v.discountValue,
          discountAmount: validation.recomputedDiscountAmount,
          discountReason: v.discountReason,
          total: validation.recomputedTotal,
          customerName: customerNameSnapshot,
          note: normalizeBillNote(v.note),
          customerId,
          cogs: hasAnyCogs ? flow.totalCogs : null,
          promoId: v.promoId ?? null,
          ...(discountApproverId
            ? { discountApprover: discountApproverId }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, v.transactionId));

      // Sesi K — promo usage tracking on edit. If the bill previously had
      // a promo, we DO NOT decrement the previous promo's currentUses
      // here (the open bill's original promo_usages row stays). When the
      // promo changes mid-edit, we wipe any pre-existing usage for this
      // transaction and re-record. This way currentUses stays accurate
      // for paid bills (the path that matters for limits).
      const existingUsages = await tx
        .select({ id: promoUsages.id, promoId: promoUsages.promoId })
        .from(promoUsages)
        .where(eq(promoUsages.transactionId, v.transactionId));
      // Decrement currentUses on any previously-recorded promos for this trx.
      for (const u of existingUsages) {
        await tx
          .update(promos)
          .set({
            currentUses: sql`GREATEST(0, ${promos.currentUses} - 1)`,
            updatedAt: new Date(),
          })
          .where(eq(promos.id, u.promoId));
      }
      if (existingUsages.length > 0) {
        await tx
          .delete(promoUsages)
          .where(eq(promoUsages.transactionId, v.transactionId));
      }
      // Record the new usage if applicable.
      if (v.promoId && validation.recomputedDiscountAmount > 0) {
        await tx.insert(promoUsages).values({
          promoId: v.promoId,
          transactionId: v.transactionId,
          outletId: session.user.outletId,
          discountAmount: validation.recomputedDiscountAmount,
          appliedBy: session.user.id,
          approverId: discountApproverId,
        });
        await tx
          .update(promos)
          .set({
            currentUses: sql`${promos.currentUses} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(promos.id, v.promoId));
      }

      for (const ti of itemsInserted) {
        const cogsForItem = flow.itemCogsByTrxItemId.get(ti.id);
        if (cogsForItem !== undefined && cogsForItem > 0) {
          await tx
            .update(transactionItems)
            .set({ cogs: cogsForItem })
            .where(eq(transactionItems.id, ti.id));
        }
      }

      await applyStockDeductions(
        tx,
        session.user.outletId,
        session.user.id,
        v.transactionId,
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
      if (modRows.length > 0) {
        await tx.insert(transactionItemModifiers).values(modRows);
      }

      return {
        deductedIngredientIds: Array.from(flow.deductionsByIngredient.keys()),
      };
    });

    if (result.deductedIngredientIds.length > 0) {
      reevaluateSoldOutForIngredients(result.deductedIngredientIds).catch(
        (e) => console.error("[sold-out re-eval edit]", e),
      );
    }

    await logAudit({
      eventType: "transaction.open_bill.edit",
      userId: session.user.id,
      approverId: discountApproverId,
      entityType: "transaction",
      entityId: v.transactionId,
      payload: {
        summary: `Edit open bill ${current.transactionNumber} — ${v.items.length} item, total Rp${validation.recomputedTotal.toLocaleString("id-ID")}`,
        before: {
          itemCount: current.items.length,
          total: current.total,
          customerName: current.customerName,
        },
        after: {
          itemCount: v.items.length,
          total: validation.recomputedTotal,
          customerName: v.customerName ?? null,
        },
        context: {
          transactionNumber: current.transactionNumber,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    const refreshed = await fetchTransactionById(v.transactionId);
    return refreshed
      ? ok(refreshed)
      : fail("DB_ERROR", "Gagal fetch transaksi setelah edit");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "NOT_FOUND") {
      return fail("NOT_FOUND", "Transaksi tidak ditemukan");
    }
    if (msg === "TRX_NOT_OPEN") {
      return fail(
        "BUSINESS_RULE_VIOLATION",
        "Bill sudah ditutup atau diedit oleh kasir lain. Refresh untuk lihat status terbaru.",
      );
    }
    if (msg.startsWith("APPROVER_TOKEN_INVALID:")) {
      return fail(
        "APPROVER_TOKEN_INVALID",
        msg.slice("APPROVER_TOKEN_INVALID:".length),
      );
    }
    return fail("DB_ERROR", logAndSanitize(e, "transactions", "Operasi database gagal"));
  }
}

// ---------- logTransactionReprint ----------

/**
 * Emit a `transaction.reprint` audit event. Called by HistoryDetailModal
 * after a successful split-print on a historical transaction. No permission
 * gate — any role that can view the transaction may reprint; audit log is
 * passive observation for abuse detection (Galih ask #9).
 */
export async function logTransactionReprint(
  transactionId: string,
  sections: ReadonlyArray<"customer" | "kitchen" | "bar">,
): Promise<ApiResult<void>> {
  const session = await requireSession();
  const trx = await fetchTransactionById(transactionId);
  if (!trx) return fail("NOT_FOUND", "Transaksi tidak ditemukan");

  await logAudit({
    eventType: "transaction.reprint",
    userId: session.user.id,
    entityType: "transaction",
    entityId: trx.id,
    payload: {
      summary: `Cetak ulang TRX ${trx.transactionNumber} (${sections.join(", ")})`,
      context: {
        transactionNumber: trx.transactionNumber,
        sections: [...sections],
        status: trx.status,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  return ok(undefined);
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

  /* Sesi AE-48 (audit Tier 2) — owner directive: nama pemilik bill wajib
   * supaya staff bisa tracking siapa belum bayar di Bill Aktif & Riwayat.
   * Sebelumnya client-side modal block tapi server tidak enforce → API
   * direct call bisa simpan bill tanpa nama → defeat purpose. Sekarang
   * server reject empty/whitespace-only customerName dengan code
   * CUSTOMER_NAME_REQUIRED supaya UI bisa render pesan jelas. */
  const customerNameTrimmed = input.customerName?.trim() ?? "";
  if (customerNameTrimmed.length === 0) {
    return fail(
      "CUSTOMER_NAME_REQUIRED",
      "Nama pemilik bill wajib diisi. Tanpa nama, staff susah tracking siapa belum bayar.",
    );
  }

  // Step 1: createTransaction with placeholder payment so validation passes
  // (cashReceived === total, cashChange === 0). Stock deduction + audit log
  // for discount fire as normal during this step.
  const placeholder: CreateTransactionInput = {
    clientRefId: input.clientRefId,
    shiftId: input.shiftId,
    cashierId: input.cashierId,
    pagerNumber: input.pagerNumber,
    orderType: input.orderType,
    customerName: customerNameTrimmed,
    customerPhone: input.customerPhone,
    note: input.note,
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
    promoId: input.promoId ?? null,
  };
  // Skip earn here — bill not yet paid. closeOpenBill fires earn when the
  // bill actually transitions to status="paid".
  const created = await createTransaction(placeholder, { skipEarn: true });
  if (!isOk(created)) return created;

  // Step 2: flip to open status + reset payment fields. cashReceived stays
  // 0 (NOT NULL) to satisfy ck_transactions_cash_fields when payment_method
  // remains 'cash' as placeholder.
  // Sesi AE-34 — perf: skip .returning() (don't need updated row, we have
  // created.data + 2 changed fields). Saves 1 RTT serializing response.
  const now = new Date();
  await db
    .update(transactions)
    .set({
      status: "open",
      cashReceived: 0,
      cashChange: 0,
      updatedAt: now,
    })
    .where(eq(transactions.id, created.data.id));

  // Sesi AE-34 — fire-and-forget audit log (existing pattern di createTransaction).
  // Audit advisory, tolerant brief delay; tidak perlu blocking response.
  logAudit({
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
  }).catch((e) => console.error("[audit open_bill]", e));

  // Sesi AE-34 — skip fetchTransactionById (yang trigger 3 round-trips:
  // select trx + items + mods + customer). created.data sudah lengkap
  // dari createTransaction(), cuma 3 field yang berubah di update. Merge
  // langsung — saves 3 RTT ≈ 300-500ms.
  return ok({
    ...created.data,
    status: "open",
    cashReceived: 0,
    cashChange: 0,
    updatedAt: now,
  });
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

  // Sesi AE-36 BUGFIX — fetch split breakdown supaya remaining ≠ total
  // saat prior splits exist. Sebelumnya validate + cashChange pakai
  // current.total raw → kasir diminta full total padahal sebagian sudah
  // dibayar via split. Sekarang remainingAmount = total - sum(splits.amount).
  const breakdown = await fetchSplitBreakdown(input.transactionId, current.total);
  const remaining = breakdown.remainingAmount;
  const hasPriorSplits = breakdown.totalPaid > 0;

  // Cash math validation — pakai remaining, bukan total.
  if (input.paymentMethod === "cash") {
    if (input.cashReceived === null || input.cashReceived < remaining) {
      return fail(
        "INSUFFICIENT_CASH",
        `Tunai kurang. Sisa Rp${remaining.toLocaleString("id-ID")}${hasPriorSplits ? ` (sudah dibayar Rp${breakdown.totalPaid.toLocaleString("id-ID")} dari total Rp${current.total.toLocaleString("id-ID")})` : ""}.`,
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
      ? input.cashReceived - remaining
      : null;

  // Sesi AE-62j — wrap close in tx + SELECT FOR UPDATE pada transaction
  // row untuk prevent TOCTOU race condition. Sebelumnya: 2 kasir (double-tap
  // / network retry) bisa lulus status='open' check + close bill twice →
  // duplicate residual split atau status flip race. Sekarang: lock parent,
  // re-validate status + breakdown fresh, then mutate.
  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          id: transactions.id,
          status: transactions.status,
          total: transactions.total,
        })
        .from(transactions)
        .where(eq(transactions.id, input.transactionId))
        .for("update")
        .limit(1);
      if (!locked) throw new Error("NOT_FOUND");
      if (locked.status !== "open") throw new Error("TRX_NOT_OPEN");

      // Re-fetch fresh paid-sum INSIDE the lock untuk re-validate remaining.
      const freshPaidAgg = await tx
        .select({
          total: sql<string>`COALESCE(SUM(${splitPayments.amount}), 0)`,
        })
        .from(splitPayments)
        .where(eq(splitPayments.transactionId, input.transactionId));
      const freshPaid = Number(freshPaidAgg[0]?.total ?? 0);
      const freshRemaining = Math.max(0, locked.total - freshPaid);
      const freshHasPriorSplits = freshPaid > 0;

      if (input.paymentMethod === "cash") {
        if (
          input.cashReceived === null ||
          input.cashReceived < freshRemaining
        ) {
          throw new Error(`INSUFFICIENT_CASH:${freshRemaining}`);
        }
      }
      const freshCashChange =
        input.paymentMethod === "cash" && input.cashReceived !== null
          ? input.cashReceived - freshRemaining
          : null;

      if (freshHasPriorSplits) {
        // Get shift for split row.
        const activeShift = await tx
          .select({ id: sql<string>`id` })
          .from(sql`shifts`)
          .where(
            sql`user_id = ${session.user.id} AND status = 'open' AND outlet_id = ${session.user.outletId}`,
          )
          .limit(1);
        if (activeShift.length === 0) {
          throw new Error("NO_ACTIVE_SHIFT");
        }
        const shiftId = activeShift[0]!.id;
        // Insert final residual split.
        await tx.insert(splitPayments).values({
          transactionId: input.transactionId,
          outletId: session.user.outletId,
          shiftId,
          cashierId: session.user.id,
          amount: freshRemaining,
          paymentMethod: input.paymentMethod,
          cashReceived:
            input.paymentMethod === "cash" ? input.cashReceived : null,
          cashChange: freshCashChange,
          splitKind: "nominal",
        });
        await tx
          .update(transactions)
          .set({
            status: "paid",
            paymentMethod: "split",
            cashReceived: null,
            cashChange: null,
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, input.transactionId));
      } else {
        await tx
          .update(transactions)
          .set({
            status: "paid",
            paymentMethod: input.paymentMethod,
            cashReceived:
              input.paymentMethod === "cash" ? input.cashReceived : null,
            cashChange:
              input.paymentMethod === "cash" ? freshCashChange : null,
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, input.transactionId));
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "DB error";
    if (msg === "NOT_FOUND") {
      return fail("NOT_FOUND", "Transaksi tidak ditemukan");
    }
    if (msg === "TRX_NOT_OPEN") {
      return fail(
        "BUSINESS_RULE_VIOLATION",
        "Bill sudah ditutup oleh kasir lain. Refresh untuk lihat status terbaru.",
      );
    }
    if (msg.startsWith("INSUFFICIENT_CASH:")) {
      const remain = msg.slice("INSUFFICIENT_CASH:".length);
      return fail(
        "INSUFFICIENT_CASH",
        `Tunai kurang. Sisa fresh setelah split lain: Rp${Number(remain).toLocaleString("id-ID")}.`,
      );
    }
    if (msg === "NO_ACTIVE_SHIFT") {
      return fail("NO_ACTIVE_SHIFT", "Buka shift dulu sebelum close bill");
    }
    return fail("DB_ERROR", logAndSanitize(e, "transactions", "Operasi database gagal"));
  }

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

  // Loyalty earn at close — first time the bill becomes "paid".
  if (current.customerId !== null) {
    earnPointsForTransaction(input.transactionId).catch((e) =>
      console.error("[loyalty earn close]", e),
    );
  }

  // Sesi T — Accounting auto-journal hook (open bill → paid). Fire here, NOT
  // di saveAsOpenBill (which calls createTransaction with skipEarn=true).
  // sesi AD-11: hoisted to static import.
  fireJournalHook(
    () =>
      postJournalForPosSale({
        outletId: session.user.outletId,
        transactionId: input.transactionId,
        actorId: session.user.id,
      }),
    "pos_sale_open_bill_close",
  );

  const refreshed = await fetchTransactionById(input.transactionId);
  return refreshed
    ? ok(refreshed)
    : fail("DB_ERROR", "Gagal fetch transaksi setelah close");
}

/**
 * Sesi AE-62k — cancelOpenBill.
 *
 * Open bill flow: saveAsOpenBill deducts stock immediately (per existing
 * behavior), tapi tidak ada cara cancel bill kalau customer batal / no-show
 * → stock permanent gone, accumulated open bills → phantom stock loss.
 *
 * Cancel flips status='voided' + restore stock + restore points + decrement
 * promo. NO journal hook fire karena bill belum paid (no GL impact saat
 * open — sale journal only fires saat close, voiding open bill = neutral).
 *
 * Permission: pos.transaction.void (same as void paid trx). Reason wajib
 * untuk audit trail.
 */
export async function cancelOpenBill(
  input: CancelOpenBillInput,
): Promise<ApiResult<Transaction>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pos.transaction.void")) {
    return fail("FORBIDDEN", "Tidak punya hak cancel open bill");
  }
  const parsed = cancelOpenBillSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  let updated: Transaction;
  let restoredIngredientIds: string[] = [];
  try {
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          id: transactions.id,
          status: transactions.status,
          outletId: transactions.outletId,
        })
        .from(transactions)
        .where(eq(transactions.id, v.transactionId))
        .for("update")
        .limit(1);
      if (!locked) throw new Error("NOT_FOUND");
      if (locked.outletId !== session.user.outletId) {
        throw new Error("FORBIDDEN");
      }
      if (locked.status !== "open") {
        throw new Error(`BAD_STATE:${locked.status}`);
      }

      const [updatedRow] = await tx
        .update(transactions)
        .set({
          status: "voided",
          voidedAt: new Date(),
          voidedBy: session.user.id,
          voidReason: `Cancel open bill: ${v.reason}`,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, v.transactionId))
        .returning();

      // Restore stock (sale_deduct → void_restore).
      const restored = await restoreStockForTransaction(
        tx,
        session.user.outletId,
        session.user.id,
        v.transactionId,
        "void_restore",
      );

      // Restore loyalty points (kalau ada redeem) + claw back earned.
      // For open bill, earn TIDAK fired di saveAsOpenBill (skipEarn=true),
      // tapi redeem mungkin terjadi → restore those.
      const { restorePointsOnTransactionRefund } = await import(
        "@/features/customers/actions"
      );
      await restorePointsOnTransactionRefund(tx, v.transactionId, {
        refundKind: "void",
        actorId: session.user.id,
      });

      // Decrement promo currentUses kalau bill pakai promo.
      const promoUsageRows = await tx
        .select({ id: promoUsages.id, promoId: promoUsages.promoId })
        .from(promoUsages)
        .where(eq(promoUsages.transactionId, v.transactionId));
      for (const u of promoUsageRows) {
        await tx
          .update(promos)
          .set({
            currentUses: sql`GREATEST(0, ${promos.currentUses} - 1)`,
            updatedAt: new Date(),
          })
          .where(eq(promos.id, u.promoId));
      }

      return { updated: updatedRow, restoredIds: restored };
    });
    updated = result.updated;
    restoredIngredientIds = result.restoredIds;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "DB error";
    if (msg === "NOT_FOUND") {
      return fail("NOT_FOUND", "Transaksi tidak ditemukan");
    }
    if (msg === "FORBIDDEN") {
      return fail("FORBIDDEN", "Transaksi dari outlet lain");
    }
    if (msg.startsWith("BAD_STATE:")) {
      const status = msg.slice("BAD_STATE:".length);
      return fail(
        "BUSINESS_RULE_VIOLATION",
        `Hanya open bill yang bisa di-cancel (status saat ini: ${status}).`,
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "transactions", "Operasi database gagal"),
    );
  }

  if (restoredIngredientIds.length > 0) {
    reevaluateSoldOutForIngredients(restoredIngredientIds).catch((err) =>
      console.error("[sold-out re-eval cancel open bill]", err),
    );
  }

  await logAudit({
    eventType: "transaction.open_bill.cancel",
    userId: session.user.id,
    entityType: "transaction",
    entityId: updated.id,
    payload: {
      summary: `Cancel open bill ${updated.transactionNumber}: ${v.reason}`,
      context: {
        transactionNumber: updated.transactionNumber,
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

// ---------- Split Payment (C-5 #13) ----------

/**
 * Read-only breakdown of split payments on a transaction. Frontend uses
 * this to render the BillCard progress badge + the per-menu split modal's
 * "remaining unpaid items" section, and HistoryDetailModal's split list.
 */
export async function getSplitBreakdown(
  transactionId: string,
): Promise<ApiResult<SplitPaymentBreakdown>> {
  await requireSession();
  const trx = await fetchTransactionById(transactionId);
  if (!trx) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  return ok(await fetchSplitBreakdown(transactionId, trx.total));
}

/**
 * Add one split-payment event to an open transaction. Validates amount
 * does not exceed remaining + (for per_menu) per-item qty does not
 * exceed unpaid qty. When the cumulative paid total reaches
 * transactions.total, the transaction is flipped to status="paid" and
 * payment_method="split" inside the same DB tx.
 *
 * Loyalty earn fires once on the FINAL split that closes the bill —
 * mirrors closeOpenBill behavior so members get points exactly once.
 */
export async function addSplitPayment(
  input: AddSplitPaymentInput,
): Promise<ApiResult<TransactionWithItems>> {
  const session = await requireSession();

  if (!hasPermission(session.user.role, "pos.transaction.create")) {
    return fail("FORBIDDEN", "Tidak punya hak proses pembayaran");
  }

  const parsed = addSplitPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const current = await fetchTransactionById(v.transactionId);
  if (!current) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  if (current.status !== "open") {
    return fail(
      "TRX_NOT_OPEN",
      `Bill sudah tidak open (status ${current.status})`,
    );
  }

  // Active shift for this user — needed for split_payments.shift_id and
  // to ensure the split is attributable in the cash recap.
  const activeShift = await db
    .select({ id: sql<string>`id` })
    .from(sql`shifts`)
    .where(
      sql`user_id = ${session.user.id} AND status = 'open' AND outlet_id = ${session.user.outletId}`,
    )
    .limit(1);
  if (activeShift.length === 0) {
    return fail("NO_ACTIVE_SHIFT", "Buka shift dulu sebelum proses pembayaran");
  }
  const shiftId = activeShift[0].id;

  if (v.paymentMethod === "cash") {
    if ((v.cashReceived ?? 0) < v.amount) {
      return fail(
        "VALIDATION_ERROR",
        "cashReceived kurang dari amount",
        "cashReceived",
      );
    }
  }

  // Pre-flight breakdown — informational only, supaya error message friendly
  // sebelum DB hit. Authoritative re-validation di-do INSIDE transaction.
  const breakdown = await fetchSplitBreakdown(v.transactionId, current.total);
  if (v.amount > breakdown.remainingAmount) {
    return fail(
      "AMOUNT_EXCEEDS_REMAINING",
      `Nominal melebihi sisa bill (sisa Rp${breakdown.remainingAmount.toLocaleString("id-ID")})`,
      "amount",
    );
  }

  if (v.splitKind === "per_menu") {
    // Per-item validation: each split item's quantity must be ≤ remaining
    // unpaid quantity for that transaction_item.
    const itemById = new Map(
      current.items.map((it) => [it.id, it.quantity]),
    );
    for (const reqItem of v.items ?? []) {
      const totalQty = itemById.get(reqItem.transactionItemId);
      if (totalQty === undefined) {
        return fail(
          "ITEM_NOT_IN_TRX",
          "Item tidak ada di transaksi ini",
          "items",
        );
      }
      const alreadyPaid =
        breakdown.paidQuantityByTrxItemId[reqItem.transactionItemId] ?? 0;
      const unpaid = totalQty - alreadyPaid;
      if (reqItem.quantity > unpaid) {
        return fail(
          "ITEM_QTY_EXCEEDS",
          `Qty melebihi sisa unpaid untuk satu item (sisa ${unpaid})`,
          "items",
        );
      }
    }
  }

  const cashChange =
    v.paymentMethod === "cash" && v.cashReceived !== null
      ? Math.max(0, v.cashReceived - v.amount)
      : null;

  let newTotalPaid = 0;
  try {
    await db.transaction(async (tx) => {
      // Sesi AE-62h — race condition guard. Sebelumnya breakdown
      // di-fetch sebelum transaction → 2 kasir paralel bisa lulus
      // validasi `v.amount > remaining` lalu duanya commit → bill
      // overpaid. Fix: SELECT FOR UPDATE pada transaksi parent row,
      // lalu re-fetch fresh paid-sum + per-item-paid INSIDE tx.
      const [lockedTrx] = await tx
        .select({
          id: transactions.id,
          status: transactions.status,
          total: transactions.total,
        })
        .from(transactions)
        .where(eq(transactions.id, v.transactionId))
        .for("update")
        .limit(1);
      if (!lockedTrx) throw new Error("NOT_FOUND");
      if (lockedTrx.status !== "open") throw new Error("TRX_NOT_OPEN");

      const freshPaidAgg = await tx
        .select({
          total: sql<string>`COALESCE(SUM(${splitPayments.amount}), 0)`,
        })
        .from(splitPayments)
        .where(eq(splitPayments.transactionId, v.transactionId));
      const freshPaid = Number(freshPaidAgg[0]?.total ?? 0);
      const freshRemaining = Math.max(0, lockedTrx.total - freshPaid);
      if (v.amount > freshRemaining) {
        throw new Error(`AMOUNT_EXCEEDS_REMAINING:${freshRemaining}`);
      }

      // Per-item fresh check (per_menu split) — re-fetch paid quantities
      // inside tx so concurrent per_menu splits don't double-pay an item.
      if (v.splitKind === "per_menu" && v.items && v.items.length > 0) {
        const reqItemIds = v.items.map((it) => it.transactionItemId);
        const freshItemRows = await tx
          .select({
            transactionItemId: splitPaymentItems.transactionItemId,
            quantity: splitPaymentItems.quantity,
          })
          .from(splitPaymentItems)
          .innerJoin(
            splitPayments,
            eq(splitPaymentItems.splitPaymentId, splitPayments.id),
          )
          .where(
            and(
              eq(splitPayments.transactionId, v.transactionId),
              inArray(splitPaymentItems.transactionItemId, reqItemIds),
            ),
          );
        const freshPaidQtyByItem = new Map<string, number>();
        for (const r of freshItemRows) {
          freshPaidQtyByItem.set(
            r.transactionItemId,
            (freshPaidQtyByItem.get(r.transactionItemId) ?? 0) + r.quantity,
          );
        }
        const itemTotalQty = new Map(
          current.items.map((it) => [it.id, it.quantity]),
        );
        for (const reqItem of v.items) {
          const totalQty = itemTotalQty.get(reqItem.transactionItemId) ?? 0;
          const alreadyPaid =
            freshPaidQtyByItem.get(reqItem.transactionItemId) ?? 0;
          const unpaid = totalQty - alreadyPaid;
          if (reqItem.quantity > unpaid) {
            throw new Error(
              `ITEM_QTY_EXCEEDS:${reqItem.transactionItemId}:${unpaid}`,
            );
          }
        }
      }

      const [splitRow] = await tx
        .insert(splitPayments)
        .values({
          transactionId: v.transactionId,
          outletId: session.user.outletId,
          shiftId,
          cashierId: session.user.id,
          amount: v.amount,
          paymentMethod: v.paymentMethod,
          cashReceived: v.paymentMethod === "cash" ? v.cashReceived : null,
          cashChange,
          splitKind: v.splitKind,
        })
        .returning();

      if (v.splitKind === "per_menu" && v.items && v.items.length > 0) {
        await tx.insert(splitPaymentItems).values(
          v.items.map((it) => ({
            splitPaymentId: splitRow.id,
            transactionItemId: it.transactionItemId,
            quantity: it.quantity,
          })),
        );
      }

      newTotalPaid = freshPaid + v.amount;
      if (newTotalPaid >= lockedTrx.total) {
        // Final split — close the bill.
        await tx
          .update(transactions)
          .set({
            status: "paid",
            paymentMethod: "split",
            cashReceived: null,
            cashChange: null,
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, v.transactionId));
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") {
      return fail("NOT_FOUND", "Transaksi tidak ditemukan");
    }
    if (msg === "TRX_NOT_OPEN") {
      return fail(
        "TRX_NOT_OPEN",
        "Bill sudah ditutup oleh kasir lain. Refresh untuk lihat status baru.",
      );
    }
    if (msg.startsWith("AMOUNT_EXCEEDS_REMAINING:")) {
      const remain = msg.slice("AMOUNT_EXCEEDS_REMAINING:".length);
      return fail(
        "AMOUNT_EXCEEDS_REMAINING",
        `Bill sudah ada split lain — sisa hanya Rp${Number(remain).toLocaleString("id-ID")}. Refresh & cek breakdown.`,
        "amount",
      );
    }
    if (msg.startsWith("ITEM_QTY_EXCEEDS:")) {
      const parts = msg.split(":");
      const unpaid = parts[2] ?? "?";
      return fail(
        "ITEM_QTY_EXCEEDS",
        `Item sudah ada split lain — sisa unpaid ${unpaid}. Refresh & cek breakdown.`,
        "items",
      );
    }
    return fail("DB_ERROR", logAndSanitize(e, "transactions", "Operasi database gagal"));
  }

  // Audit (best-effort, mirrors createTransaction pattern).
  logAudit({
    eventType: "transaction.split_payment.add",
    userId: session.user.id,
    entityType: "transaction",
    entityId: v.transactionId,
    payload: {
      summary: `Split ${v.splitKind} Rp${v.amount.toLocaleString("id-ID")} via ${v.paymentMethod} pada ${current.transactionNumber}`,
      context: {
        transactionNumber: current.transactionNumber,
        amount: v.amount,
        paymentMethod: v.paymentMethod,
        splitKind: v.splitKind,
        itemsCount: v.items?.length ?? 0,
        totalPaidAfter: breakdown.totalPaid + v.amount,
        billTotal: current.total,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit split]", e));

  // Loyalty earn — only when this split closes the bill.
  if (newTotalPaid >= current.total && current.customerId !== null) {
    earnPointsForTransaction(v.transactionId).catch((e) =>
      console.error("[loyalty earn split]", e),
    );
  }

  const refreshed = await fetchTransactionById(v.transactionId);
  return refreshed
    ? ok(refreshed)
    : fail("DB_ERROR", "Gagal fetch transaksi setelah split");
}
