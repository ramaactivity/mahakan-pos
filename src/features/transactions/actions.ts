"use server";

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
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
  actionType: ApprovalActionType,
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

  // Resolve loyalty customer if a phone was provided. find-or-create — name
  // defaults to customerName (or "Member <phone>" fallback). Failure here
  // shouldn't block the sale; we proceed with no customer linkage.
  let customerId: string | null = null;
  let customerNameSnapshot = v.customerName ?? null;
  let resolvedCustomerBalance = 0;
  if (v.customerPhone) {
    const customerRes = await findOrCreateCustomer({
      phone: v.customerPhone,
      name: v.customerName ?? `Member ${v.customerPhone}`,
    });
    if (customerRes.success) {
      customerId = customerRes.data.id;
      resolvedCustomerBalance = customerRes.data.totalPoints;
      // Use the canonical customer name from the loyalty record so the struk
      // and history reflect the registered name (kasir's free-text label
      // takes priority though if explicitly typed).
      if (!customerNameSnapshot) {
        customerNameSnapshot = customerRes.data.name;
      }
    }
    // If find-or-create failed (e.g. invalid phone), silently continue
    // without loyalty linkage — sale must not block on this.
  }

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
    if (!opts.skipEarn && result.trx.status === "paid") {
      const { fireJournalHook, postJournalForPosSale } = await import(
        "@/features/accounting/hooks"
      );
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
  {
    const { fireJournalHook, postJournalForPosRefund } = await import(
      "@/features/accounting/hooks"
    );
    fireJournalHook(
      () =>
        postJournalForPosRefund({
          outletId: session.user.outletId,
          transactionId: result.id,
          refundEventId: result.id, // full-refund: 1:1 ke transaction
          refundedAmount: result.total,
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

  return ok({ transaction: result.transaction, eventId: result.eventId });
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

  // Approver token consumption — Staff initiating discount on edit needs PIN.
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
      return fail(
        "APPROVER_TOKEN_INVALID",
        e instanceof Error ? e.message : "Token gagal",
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
  let customerNameSnapshot = v.customerName ?? current.customerName;
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

  try {
    const result = await db.transaction(async (tx) => {
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
    return fail("DB_ERROR", e instanceof Error ? e.message : "Database error");
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

  // Step 1: createTransaction with placeholder payment so validation passes
  // (cashReceived === total, cashChange === 0). Stock deduction + audit log
  // for discount fire as normal during this step.
  const placeholder: CreateTransactionInput = {
    clientRefId: input.clientRefId,
    shiftId: input.shiftId,
    cashierId: input.cashierId,
    pagerNumber: input.pagerNumber,
    orderType: input.orderType,
    customerName: input.customerName,
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
  // NOTE: intentionally NOT checking assertShiftOpen here. Sesi Z #5 was
  // scoped to refund/void/edit only — close-open-bill across shifts is
  // legit (customer comes back next day to pay yesterday's bill). The
  // payment still attributes to current.shiftId; if that becomes a recap
  // gap, surface separately in a follow-up.

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

  // Loyalty earn at close — first time the bill becomes "paid".
  if (current.customerId !== null) {
    earnPointsForTransaction(input.transactionId).catch((e) =>
      console.error("[loyalty earn close]", e),
    );
  }

  // Sesi T — Accounting auto-journal hook (open bill → paid). Fire here, NOT
  // di saveAsOpenBill (which calls createTransaction with skipEarn=true).
  {
    const { fireJournalHook, postJournalForPosSale } = await import(
      "@/features/accounting/hooks"
    );
    fireJournalHook(
      () =>
        postJournalForPosSale({
          outletId: session.user.outletId,
          transactionId: input.transactionId,
          actorId: session.user.id,
        }),
      "pos_sale_open_bill_close",
    );
  }

  const refreshed = await fetchTransactionById(input.transactionId);
  return refreshed
    ? ok(refreshed)
    : fail("DB_ERROR", "Gagal fetch transaksi setelah close");
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

  // Compute current breakdown to validate amount + per-item qty.
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

  try {
    await db.transaction(async (tx) => {
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

      const newTotalPaid = breakdown.totalPaid + v.amount;
      if (newTotalPaid >= current.total) {
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
    const msg = e instanceof Error ? e.message : "DB error";
    return fail("DB_ERROR", msg);
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
  const newTotalPaid = breakdown.totalPaid + v.amount;
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
