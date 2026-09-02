"use server";

import { and, eq, getTableColumns, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalCodes,
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
import { requiresPinApprover } from "@/features/approval-codes/compliment-guard";
import { verifyComplimentPinForOutlet } from "@/features/approval-codes/compliment-pin";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { consumeApproverToken } from "@/lib/auth/approver";
import { logAudit } from "@/lib/audit/logger";
import { runAfterResponse } from "@/lib/after-response";
import { logAndSanitize } from "@/lib/server-error";
import {
  applyStockDeductions,
  computeStockFlowForOrder,
  reevaluateSoldOutForIngredients,
  restoreStockForTransaction,
} from "@/features/inventory/transaction-flow";
import { getStockMode } from "@/features/inventory/flag";
import {
  computeRedemptionAmount,
  findOrCreateCustomer,
} from "@/features/customers";
import {
  bumpCustomerRedeemInTx,
  earnPointsForTransaction,
} from "@/features/customers/loyalty-internal";
import {
  consumeApprovalCode,
  isOk as isApprovalOk,
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
 * Pre-authorize void/refund — RESOLVE mode + validate kelengkapan
 * credential, TANPA consume token/code. Caller wajib `consumeVoidRefundCredential`
 * INSIDE db.transaction(...) supaya consume atomic dengan source action
 * (Sesi AE-62v — fix orphan token risk).
 */
type VoidRefundAuth =
  | {
      ok: true;
      mode: "code";
      approvalCode: string;
      ownerId: string | null;
    }
  | {
      ok: true;
      mode: "pin";
      approverToken: string;
    }
  | {
      ok: true;
      mode: "direct_owner";
      ownerId: string;
    }
  | { ok: false; code: string; message: string };

async function prepareVoidRefundAuth(
  outletId: string,
  actionType: "pos.transaction.void" | "pos.transaction.refund",
  v: {
    approverToken?: string;
    approvalCode?: string;
    directOwnerApprove?: boolean;
  },
  callerSession: { userId: string; role: string },
): Promise<VoidRefundAuth> {
  const kind = actionType === "pos.transaction.void" ? "void" : "refund";

  // Direct-owner override (Pusat Persetujuan path) — takes precedence supaya
  // owner tidak terblok meski outlet settings.voidMode = "pin" (PIN-only).
  if (v.directOwnerApprove === true) {
    if (callerSession.role !== "owner") {
      return {
        ok: false,
        code: "FORBIDDEN_DIRECT_APPROVE",
        message: "Direct approve hanya untuk Owner — kasir/manager pakai jalur kode/PIN.",
      };
    }
    return {
      ok: true,
      mode: "direct_owner",
      ownerId: callerSession.userId,
    };
  }

  const mode = await resolveApprovalMode(outletId, kind);
  if (mode === "code") {
    if (!v.approvalCode) {
      return {
        ok: false,
        code: "APPROVAL_CODE_REQUIRED",
        message: `${kind === "void" ? "Void" : "Refund"} butuh kode approval dari Owner`,
      };
    }
    const ownerId = await resolveActiveOwnerId(outletId);
    return {
      ok: true,
      mode: "code",
      approvalCode: v.approvalCode,
      ownerId,
    };
  }
  if (!v.approverToken) {
    return {
      ok: false,
      code: "APPROVER_REQUIRED",
      message: `${kind === "void" ? "Void" : "Refund"} butuh PIN approver`,
    };
  }
  return { ok: true, mode: "pin", approverToken: v.approverToken };
}

/**
 * Consume void/refund credential INSIDE outer db.transaction (Sesi AE-62v).
 * Returns approverId atau throws untuk caller catch.
 */
async function consumeVoidRefundCredential(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  prepared: Extract<VoidRefundAuth, { ok: true }>,
  transactionId: string,
  actionType: "pos.transaction.void" | "pos.transaction.refund",
): Promise<string | null> {
  if (prepared.mode === "code") {
    // Note: consumeApprovalCode tidak tx-aware (uses its own atomicity via
    // approvalCodes table update); orphan risk lebih kecil karena code-mode
    // sudah single-use enforced via approvalCodes.consumedAt. Acceptable.
    const res = await consumeApprovalCode(
      transactionId,
      actionType,
      prepared.approvalCode,
    );
    if (!isApprovalOk(res)) {
      throw new Error(`APPROVAL_CODE_FAILED:${res.error.code}:${res.error.message}`);
    }
    return prepared.ownerId;
  }
  if (prepared.mode === "direct_owner") {
    // Revoke any active codes untuk trx ini + actionType — owner sudah
    // approve langsung di Pusat Persetujuan, kode lama jadi obsolete.
    // Inside tx supaya rollback safe kalau void/refund mutation gagal.
    await tx
      .update(approvalCodes)
      .set({
        revokedAt: new Date(),
        revokedByUserId: prepared.ownerId,
      })
      .where(
        and(
          eq(approvalCodes.targetTransactionId, transactionId),
          eq(approvalCodes.actionType, actionType),
          isNull(approvalCodes.consumedAt),
          isNull(approvalCodes.revokedAt),
        ),
      );
    return prepared.ownerId;
  }
  // PIN mode — consume token inside this tx supaya atomic dengan source action.
  try {
    const consumed = await consumeApproverToken(
      prepared.approverToken,
      actionType,
      transactionId,
      tx,
    );
    return consumed.approverId;
  } catch (e) {
    throw new Error(
      `APPROVER_TOKEN_INVALID:${e instanceof Error ? e.message : "Token gagal"}`,
    );
  }
}
import {
  fetchSplitBreakdown,
  fetchTransactionByClientRefId,
  fetchTransactionById,
  fetchTransactions,
  fetchTransactionSummaries,
  fetchTransactionsByIds,
  type ListTransactionsOptions,
  type TransactionSummary,
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
import { POS_ORIGIN } from "@/features/cash/drawer-origin";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/**
 * Sesi AE-131 perf — Batch decrement promo.current_uses untuk N usages.
 *
 * Sebelumnya: for (const u of promoUsageRows) await tx.update(promos)...
 * = N round-trips × ~30-100ms Neon RTT = significant pada void/refund
 * dengan banyak promo. Sekarang: ONE single UPDATE dengan CASE expression
 * supaya semua decrement happen in 1 round-trip.
 *
 * Mendukung multiple usages dari promoId yang sama (count > 1 per id).
 *
 * No-op kalau usageRows empty.
 */
async function batchDecrementPromoUses(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  usageRows: ReadonlyArray<{ promoId: string }>,
): Promise<void> {
  if (usageRows.length === 0) return;
  // Group by promoId untuk hitung total decrement per promo.
  const decrementByPromoId = new Map<string, number>();
  for (const u of usageRows) {
    decrementByPromoId.set(
      u.promoId,
      (decrementByPromoId.get(u.promoId) ?? 0) + 1,
    );
  }
  const promoIds = Array.from(decrementByPromoId.keys());
  // Build CASE WHEN id = '...' THEN N expression untuk per-promo decrement.
  const caseClauses = sql.join(
    Array.from(decrementByPromoId.entries()).map(
      ([id, count]) => sql`WHEN ${id} THEN ${count}`,
    ),
    sql.raw(" "),
  );
  await tx.execute(sql`
    UPDATE promos
    SET current_uses = GREATEST(0, current_uses - (CASE id ${caseClauses} ELSE 0 END)),
        updated_at = NOW()
    WHERE id IN (${sql.join(promoIds.map((id) => sql`${id}`), sql.raw(", "))})
  `);
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

/**
 * Audit AE-187 — versi ringan (±10 kolom) untuk list yang di-poll POS tiap
 * 45 detik (KDS + Open Bill). Pakai ini untuk polling; listTransactions
 * full-row tetap ada untuk layar yang butuh semua kolom.
 */
export async function listTransactionSummaries(
  opts: ListTransactionsOptions = {},
): Promise<ApiResult<Paginated<TransactionSummary>>> {
  await requireSession();
  return ok(await fetchTransactionSummaries(opts));
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
  opts: {
    skipEarn?: boolean;
    /** Sesi AE-62x — kalau true (dipakai dari saveAsOpenBill), skip
     * applyStockDeductions + leave transactions.stock_deducted_at NULL.
     * closeOpenBill akan deduct nanti saat bill di-pay. */
    deferStock?: boolean;
  } = {},
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
  /* Sesi AE-63 phase10 — shift OUTLET scope (bukan per-user). Workflow
   * Mahakan: 1 shift per outlet, shared antara kasir + owner + manager.
   * Pre-fix `shift.userId !== session.user.id` BLOCK owner/manager dari
   * buat transaksi pakai shift staff yang sudah buka shift duluan.
   * transaction.createdBy tetap capture session.user.id untuk audit. */
  if (shift.outletId !== session.user.outletId) {
    return fail("SHIFT_OUTLET_MISMATCH", "Shift dari outlet lain");
  }

  // Approver token consumption — if discount applied AND user is staff.
  // NOT parallelized with the batch above because token consume is
  // destructive (decrements a counter) — we don't want to consume a token
  // if shift validation will fail.
  // Sesi AE-62v — validate token presence early, DEFER consume ke INSIDE tx.
  // Sebelumnya consume di sini → kalau menu check / DB insert later gagal,
  // token jadi orphan (staff harus minta PIN baru tanpa transaksi terjadi).
  /* Sesi AE-208 — compliment TIDAK lewat gerbang PIN APPROVER.
   *
   * Compliment punya gerbangnya sendiri beberapa baris di bawah (PIN
   * compliment, sesi AE-221). Kalau gerbang diskon di sini ikut menuntut PIN
   * approver untuk SEMUA diskon staff, kasir yang PIN compliment-nya sudah
   * benar tetap ditolak APPROVER_REQUIRED — compliment jadi mustahil
   * diselesaikan, persis kejadian yang ditambal di AE-208. */
  const isComplimentTrx = (v.discountReason ?? "").startsWith("Compliment:");

  const needsPinApprover = requiresPinApprover({
    discountAmount: v.discountAmount,
    role: session.user.role,
    isCompliment: isComplimentTrx,
  });

  let discountApproverId: string | null = null;
  if (needsPinApprover) {
    if (!v.discountApproverToken) {
      return fail(
        "APPROVER_REQUIRED",
        "Staff butuh approver untuk apply discount",
      );
    }
  }

  // Authorize discount apply for non-staff (Owner/Manager use their own session)
  if (
    v.discountAmount > 0 &&
    session.user.role !== "staff" &&
    !isComplimentTrx
  ) {
    if (!hasPermission(session.user.role, "pos.discount.apply")) {
      return fail("FORBIDDEN", "Tidak punya hak apply discount");
    }
  }

  /* Sesi AE-221 — COMPLIMENT dijaga PIN STATIS (menggantikan kode owner
   * AE-195, atas permintaan owner).
   *
   * Tetap ditegakkan di SERVER, bukan cuma di layar POS: kalau hanya modal
   * yang memeriksa, siapa pun yang bisa memanggil action ini menggratiskan
   * transaksi tanpa gerbang apa pun.
   *
   * Owner dikecualikan — dialah pemilik keputusannya, jadi memintanya
   * mengetik PIN-nya sendiri tidak menambah kontrol (pola sama dengan
   * direct-approve di Pusat Persetujuan).
   */
  if (isComplimentTrx && session.user.role !== "owner") {
    const pinOk = await verifyComplimentPinForOutlet(
      session.user.outletId,
      v.complimentPin,
    );
    if (!pinOk) {
      return fail(
        "COMPLIMENT_PIN_INVALID",
        "PIN compliment salah atau belum diatur Owner",
      );
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

  /* Sesi AE-155 — Split metode payment validation untuk direct sale.
   * Saat splits non-empty: paymentMethod harus "split", cashReceived +
   * cashChange harus null, sum splits.amount harus = recomputedTotal. */
  const splits = v.splits ?? [];
  if (splits.length > 0) {
    if (v.paymentMethod !== "split") {
      return fail(
        "SPLIT_METHOD_MISMATCH",
        "paymentMethod harus 'split' kalau pakai splits array",
      );
    }
    if (v.cashReceived !== null || v.cashChange !== null) {
      return fail(
        "SPLIT_CASH_FIELDS_INVALID",
        "cashReceived + cashChange harus null untuk split (lihat constraint check_split_amount). Per-split punya cashReceived sendiri.",
      );
    }
    if (splits.length < 2) {
      return fail(
        "SPLIT_TOO_FEW",
        "Split butuh minimal 2 metode. Kalau cuma 1 metode pakai paymentMethod biasa.",
      );
    }
    const sumSplits = splits.reduce((acc, s) => acc + s.amount, 0);
    if (sumSplits !== validation.recomputedTotal) {
      return fail(
        "SPLIT_AMOUNT_MISMATCH",
        `Total split (Rp ${sumSplits.toLocaleString("id-ID")}) tidak sama dengan total bill (Rp ${validation.recomputedTotal.toLocaleString("id-ID")})`,
      );
    }
    /* Per-split cash field check: cash split punya cashReceived non-null,
     * non-cash split harus null. */
    for (const s of splits) {
      if (s.paymentMethod === "cash") {
        if (s.cashReceived === null || s.cashReceived < s.amount) {
          return fail(
            "SPLIT_CASH_INSUFFICIENT",
            `Split cash Rp ${s.amount.toLocaleString("id-ID")}: uang diterima kurang`,
          );
        }
        if (s.cashChange === null || s.cashChange !== s.cashReceived - s.amount) {
          return fail(
            "SPLIT_CASH_CHANGE_MISMATCH",
            "Split cash: cashChange harus = cashReceived - amount",
          );
        }
      } else {
        if (s.cashReceived !== null || s.cashChange !== null) {
          return fail(
            "SPLIT_NONCASH_CASH_FIELDS",
            "Split non-cash: cashReceived + cashChange harus null",
          );
        }
      }
    }
  } else {
    /* Tidak ada splits → paymentMethod tidak boleh "split". */
    if (v.paymentMethod === "split") {
      return fail(
        "SPLIT_REQUIRED",
        "paymentMethod='split' butuh splits array minimal 2 entry",
      );
    }
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
      // Sesi AE-62v — consume discount approver token INSIDE tx (atomic
      // rollback bila tx fail). Token presence sudah di-validate di luar.
      // AE-208: compliment tidak pakai PIN (kode owner), jadi tidak ada
      // token untuk dikonsumsi — jangan paksa `!` pada nilai null.
      if (needsPinApprover) {
        try {
          const consumed = await consumeApproverToken(
            v.discountApproverToken!,
            "pos.discount.apply",
            null,
            tx,
          );
          discountApproverId = consumed.approverId;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Token gagal";
          throw new Error(`APPROVER_TOKEN_INVALID:${msg}`);
        }
      }

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
          /* Sesi AE-155 — split method: per-split cash di split_payments
           * table. Trx-level cashReceived + cashChange null per
           * ck_transactions_cash_split_consistency constraint. */
          cashReceived:
            v.paymentMethod === "cash" ? v.cashReceived : null,
          cashChange: v.paymentMethod === "cash" ? v.cashChange : null,
          status: "paid",
          discountApprover: discountApproverId,
          promoId: v.promoId ?? null,
        })
        .returning();


      // Sesi K — when discount sourced from a master promo, record the
      // usage + bump currentUses. Both inside the same DB tx so a rollback
      // (e.g. stock failure later) also rolls back the usage row.
      //
      // Sesi AE-62z — SELECT FOR UPDATE pada promo + pre-validate
      // currentUses+1 vs maxTotalUses. Schema CHECK constraint sudah
      // guard (ck_promos_uses_consistent), tapi tanpa pre-check error
      // surface ke kasir sebagai "DB_ERROR" generic. Sekarang explicit
      // PROMO_MAX_USES_EXCEEDED supaya kasir tahu promo udah habis.
      if (v.promoId && validation.recomputedDiscountAmount > 0) {
        const [promoLocked] = await tx
          .select({
            id: promos.id,
            currentUses: promos.currentUses,
            maxTotalUses: promos.maxTotalUses,
            status: promos.status,
          })
          .from(promos)
          .where(eq(promos.id, v.promoId))
          .for("update")
          .limit(1);
        if (!promoLocked) {
          throw new Error("PROMO_NOT_FOUND");
        }
        if (promoLocked.status !== "active") {
          throw new Error(`PROMO_NOT_ACTIVE:${promoLocked.status}`);
        }
        if (
          promoLocked.maxTotalUses !== null &&
          promoLocked.currentUses + 1 > promoLocked.maxTotalUses
        ) {
          throw new Error(
            `PROMO_MAX_USES_EXCEEDED:${promoLocked.maxTotalUses}`,
          );
        }
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

      // Sesi AE-62x — defer stock kalau saveAsOpenBill (deferStock=true).
      // Direct sale: deduct sekarang + stamp stock_deducted_at.
      // Open bill: skip + leave NULL → closeOpenBill akan deduct.
      // Sesi AE-173 — mode periodic (deductOnSale=false): TIDAK deduct, biarkan
      // stock_deducted_at NULL. COGS tetap ke-stamp (flow di atas).
      const { deductOnSale } = await getStockMode(session.user.outletId, tx);
      if (!opts.deferStock && deductOnSale) {
        await applyStockDeductions(
          tx,
          session.user.outletId,
          session.user.id,
          insertedTrx.id,
          flow,
        );
        await tx
          .update(transactions)
          .set({ stockDeductedAt: new Date() })
          .where(eq(transactions.id, insertedTrx.id));
      }

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

      /* Sesi AE-155 — Insert split_payments rows untuk direct-sale split.
       * Existing addSplitPayment action dipakai open-bill flow (add-then-
       * close). Untuk direct sale: trx ter-create paid + splits sekaligus
       * dalam 1 tx. splitKind selalu "nominal" (per_menu tidak make sense
       * untuk direct sale single customer). Constraint trx.paymentMethod
       * = "split" + cashReceived + cashChange null sudah enforced di
       * pre-validation. */
      if (splits.length > 0) {
        await tx.insert(splitPayments).values(
          splits.map((s) => ({
            transactionId: insertedTrx.id,
            outletId: session.user.outletId,
            shiftId: v.shiftId,
            cashierId: session.user.id,
            amount: s.amount,
            paymentMethod: s.paymentMethod,
            cashReceived: s.paymentMethod === "cash" ? s.cashReceived : null,
            cashChange: s.paymentMethod === "cash" ? s.cashChange : null,
            splitKind: "nominal" as const,
          })),
        );
      }

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
      runAfterResponse(
        () => reevaluateSoldOutForIngredients(result.deductedIngredientIds),
        "sold-out-sale",
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
      runAfterResponse(() =>
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
        }), "audit-discount");
    }

    // Loyalty redemption audit — emitted after the sale tx commits since
    // the deduction was atomic with the insert. Records the count of
    // points spent + new member balance for compliance/abuse monitoring.
    const memberAfterRedeem = result.memberAfterRedeem;
    if (redeemPoints > 0 && memberAfterRedeem) {
      runAfterResponse(() =>
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
              memberBalanceAfter: memberAfterRedeem.totalPoints,
              memberPhone: memberAfterRedeem.phone,
            },
          },
          metadata: {
            outletId: session.user.outletId,
            actorRole: session.user.role,
          },
        }), "audit-redeem");
    }

    // Loyalty earn — best-effort, fired after the sale tx commits. Skipped
    // when called from saveAsOpenBill (status will be flipped to "open"
    // before the bill is paid; closeOpenBill fires earn later).
    if (!opts.skipEarn && customerId !== null) {
      runAfterResponse(
        () => earnPointsForTransaction(result.trx.id),
        "loyalty-earn",
      );
    }

    // Sesi T — Accounting auto-journal hook (fire-and-forget, feature-flagged).
    // Skipped when saveAsOpenBill calls (status flipped to 'open' before paid).
    // sesi AD-11: hoisted dynamic import to top of file to skip ~5-10ms
    // module load on every paid transaction.
    if (!opts.skipEarn && result.trx.status === "paid") {
      const posSaleArgs = {
        outletId: session.user.outletId,
        transactionId: result.trx.id,
        actorId: session.user.id,
      };
      fireJournalHook(
        () => postJournalForPosSale(posSaleArgs),
        "pos_sale",
        {
          sourceId: result.trx.id,
          outletId: session.user.outletId,
          actorId: session.user.id,
        },
        { label: "pos_sale", args: posSaleArgs },
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
    /* Sesi AE-62v — approver token consume yang sekarang INSIDE tx throws
     * dengan prefix APPROVER_TOKEN_INVALID:. Surface clean error ke kasir. */
    if (e instanceof Error && e.message.startsWith("APPROVER_TOKEN_INVALID:")) {
      return fail(
        "APPROVER_TOKEN_INVALID",
        e.message.replace(/^APPROVER_TOKEN_INVALID:/, "") || "Token gagal",
      );
    }
    /* Sesi AE-62z — promo guard errors. */
    if (e instanceof Error && e.message === "PROMO_NOT_FOUND") {
      return fail("PROMO_NOT_FOUND", "Promo tidak ditemukan");
    }
    if (e instanceof Error && e.message.startsWith("PROMO_NOT_ACTIVE:")) {
      const status = e.message.replace(/^PROMO_NOT_ACTIVE:/, "");
      return fail(
        "PROMO_NOT_ACTIVE",
        `Promo tidak aktif (status: ${status}). Pilih promo lain atau hapus promo dari bill.`,
      );
    }
    if (e instanceof Error && e.message.startsWith("PROMO_MAX_USES_EXCEEDED:")) {
      const max = e.message.replace(/^PROMO_MAX_USES_EXCEEDED:/, "");
      return fail(
        "PROMO_MAX_USES_EXCEEDED",
        `Promo sudah mencapai batas maksimal (${max}). Pilih promo lain atau hapus dari bill.`,
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
  // Sesi AE-62v — pre-resolve credential mode + validate kelengkapan TANPA
  // consume. Actual consume di-defer ke INSIDE db.transaction supaya atomic.
  const prepared = await prepareVoidRefundAuth(
    session.user.outletId,
    "pos.transaction.void",
    v,
    { userId: session.user.id, role: session.user.role },
  );
  if (!prepared.ok) {
    return fail(prepared.code, prepared.message);
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
  const shiftCheck = await assertShiftOpen(current.shiftId);
  if (!shiftCheck.ok) return fail(shiftCheck.code, shiftCheck.message);

  let approverId: string | null = null;
  let updated: typeof transactions.$inferSelect;
  let restoredIngredientIds: string[];
  try {
    const txResult = await db.transaction(async (tx) => {
      // Sesi AE-62v — consume credential INSIDE tx supaya rollback safe.
      approverId = await consumeVoidRefundCredential(
        tx,
        prepared,
        v.transactionId,
        "pos.transaction.void",
      );

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
      "@/features/customers/loyalty-internal"
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
    /* Sesi AE-131 perf — batch decrement, was N round-trips per loop. */
    await batchDecrementPromoUses(tx, promoUsageRows);

      return { updated: updatedRow, restoredIngredientIds: restored };
    });
    updated = txResult.updated;
    restoredIngredientIds = txResult.restoredIngredientIds;
  } catch (e) {
    /* Sesi AE-62v — surface credential errors clean ke kasir (was 500
     * sebelumnya karena throw bubble out of tx callback). */
    if (e instanceof Error && e.message.startsWith("APPROVER_TOKEN_INVALID:")) {
      return fail(
        "APPROVER_TOKEN_INVALID",
        e.message.replace(/^APPROVER_TOKEN_INVALID:/, "") || "Token gagal",
      );
    }
    if (e instanceof Error && e.message.startsWith("APPROVAL_CODE_FAILED:")) {
      const rest = e.message.replace(/^APPROVAL_CODE_FAILED:/, "");
      const [code, ...msgParts] = rest.split(":");
      return fail(code || "APPROVAL_CODE_FAILED", msgParts.join(":") || "Kode approval gagal");
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "transactions.void", "Operasi database gagal"),
    );
  }

  if (restoredIngredientIds.length > 0) {
    runAfterResponse(
      () => reevaluateSoldOutForIngredients(restoredIngredientIds),
      "sold-out-void",
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
    const posVoidArgs = {
      outletId: session.user.outletId,
      transactionId: v.transactionId,
      items: aggItems,
      actorId: session.user.id,
    };
    fireJournalHook(
      () => postJournalForPosVoid(posVoidArgs),
      "pos_void",
      {
        sourceId: v.transactionId,
        outletId: session.user.outletId,
        actorId: session.user.id,
      },
      { label: "pos_void", args: posVoidArgs },
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

  // Sesi AE-62v — pre-resolve credential mode, defer consume ke INSIDE tx.
  const prepared = await prepareVoidRefundAuth(
    session.user.outletId,
    "pos.transaction.refund",
    v,
    { userId: session.user.id, role: session.user.role },
  );
  if (!prepared.ok) {
    return fail(prepared.code, prepared.message);
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

  let approverId: string | null = null;
  let result: typeof transactions.$inferSelect;
  let restoredIngredientIds: string[];
  try {
    const txResult = await db.transaction(async (tx) => {
      // Sesi AE-62v — consume credential INSIDE tx untuk atomic rollback.
      approverId = await consumeVoidRefundCredential(
        tx,
        prepared,
        v.transactionId,
        "pos.transaction.refund",
      );

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
        /* Sesi AE-227 — refund dibayarkan kasir dari laci saat itu juga,
         * jadi ini memang mengurangi isi laci (bukan input dashboard). */
        entryOrigin: POS_ORIGIN,
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
        "@/features/customers/loyalty-internal"
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
      /* Sesi AE-131 perf — batch decrement. */
      await batchDecrementPromoUses(tx, promoUsageRows);

      return { result: updated, restoredIngredientIds: restored };
    });
    result = txResult.result;
    restoredIngredientIds = txResult.restoredIngredientIds;
  } catch (e) {
    /* Sesi AE-62v — surface credential errors clean. */
    if (e instanceof Error && e.message.startsWith("APPROVER_TOKEN_INVALID:")) {
      return fail(
        "APPROVER_TOKEN_INVALID",
        e.message.replace(/^APPROVER_TOKEN_INVALID:/, "") || "Token gagal",
      );
    }
    if (e instanceof Error && e.message.startsWith("APPROVAL_CODE_FAILED:")) {
      const rest = e.message.replace(/^APPROVAL_CODE_FAILED:/, "");
      const [code, ...msgParts] = rest.split(":");
      return fail(code || "APPROVAL_CODE_FAILED", msgParts.join(":") || "Kode approval gagal");
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "transactions.refund", "Operasi database gagal"),
    );
  }

  if (restoredIngredientIds.length > 0) {
    runAfterResponse(
      () => reevaluateSoldOutForIngredients(restoredIngredientIds),
      "sold-out-refund",
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
    const fullRefundArgs = {
      outletId: session.user.outletId,
      transactionId: result.id,
      refundEventId: result.id, // full-refund: 1:1 ke transaction
      refundedAmount: result.total,
      items: aggItems,
      reverseCogs: true,
      actorId: session.user.id,
    };
    fireJournalHook(
      () => postJournalForPosRefund(fullRefundArgs),
      "pos_refund_full",
      {
        sourceId: result.id,
        outletId: session.user.outletId,
        actorId: session.user.id,
      },
      { label: "pos_refund", args: fullRefundArgs },
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

  /* Sesi AE-62v — idempotency: kalau clientRefId provided dan refund_event
   * dengan id ini sudah ada, return existing (cepat, tanpa re-execute side
   * effects). Mencegah duplicate refund + double GL post saat network retry. */
  if (v.clientRefId) {
    const [existing] = await db
      .select({
        id: refundEvents.id,
        transactionId: refundEvents.transactionId,
      })
      .from(refundEvents)
      .where(eq(refundEvents.clientRefId, v.clientRefId))
      .limit(1);
    if (existing) {
      // Defensive: ensure clientRefId-matched event belongs to same trx (paranoia).
      if (existing.transactionId !== v.transactionId) {
        return fail(
          "CLIENT_REF_ID_MISMATCH",
          "ID idempotency mismatch — generate UUID baru untuk submit ini.",
        );
      }
      const [currentTrx] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, existing.transactionId))
        .limit(1);
      if (currentTrx) {
        return ok({ transaction: currentTrx, eventId: existing.id });
      }
    }
  }

  // Sesi AE-62v — pre-resolve credential, defer consume ke INSIDE tx.
  const prepared = await prepareVoidRefundAuth(
    session.user.outletId,
    "pos.transaction.refund",
    v,
    { userId: session.user.id, role: session.user.role },
  );
  if (!prepared.ok) {
    return fail(prepared.code, prepared.message);
  }

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

  let approverId: string | null = null;
  let result: { transaction: typeof transactions.$inferSelect; eventId: string };
  try {
    result = await db.transaction(async (tx) => {
    // Sesi AE-62v — consume credential INSIDE tx untuk atomic rollback.
    approverId = await consumeVoidRefundCredential(
      tx,
      prepared,
      v.transactionId,
      "pos.transaction.refund",
    );
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
        /* Sesi AE-62v — store clientRefId untuk idempotent retry. */
        clientRefId: v.clientRefId ?? null,
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
      /* Sesi AE-227 — refund parsial juga keluar dari laci kasir. */
      entryOrigin: POS_ORIGIN,
      createdBy: session.user.id,
    });

    // Sesi AE-62i — pro-rate claw-back earned points sesuai refund share.
    // Kalau partial bertahap → tiap event clawback proportional. Kalau
    // cumulative reach total (nextStatus='refunded') → full clawback +
    // restore redeemed.
    const { restorePointsOnTransactionRefund } = await import(
      "@/features/customers/loyalty-internal"
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
  } catch (e) {
    /* Sesi AE-62v — race: 2 parallel POST dengan same clientRefId, first
     * wins INSERT (ux_refund_events_client_ref UNIQUE), second gets dup
     * error. Recovery: return existing event sebagai "ok" (idempotent semantic). */
    if (
      v.clientRefId &&
      e instanceof Error &&
      /ux_refund_events_client_ref|client_ref_id|unique/i.test(e.message)
    ) {
      const [existing] = await db
        .select({
          id: refundEvents.id,
          transactionId: refundEvents.transactionId,
        })
        .from(refundEvents)
        .where(eq(refundEvents.clientRefId, v.clientRefId))
        .limit(1);
      if (existing) {
        const [currentTrx] = await db
          .select()
          .from(transactions)
          .where(eq(transactions.id, existing.transactionId))
          .limit(1);
        if (currentTrx) {
          return ok({ transaction: currentTrx, eventId: existing.id });
        }
      }
    }
    /* Sesi AE-62v — surface credential errors clean. */
    if (e instanceof Error && e.message.startsWith("APPROVER_TOKEN_INVALID:")) {
      return fail(
        "APPROVER_TOKEN_INVALID",
        e.message.replace(/^APPROVER_TOKEN_INVALID:/, "") || "Token gagal",
      );
    }
    if (e instanceof Error && e.message.startsWith("APPROVAL_CODE_FAILED:")) {
      const rest = e.message.replace(/^APPROVAL_CODE_FAILED:/, "");
      const [code, ...msgParts] = rest.split(":");
      return fail(code || "APPROVAL_CODE_FAILED", msgParts.join(":") || "Kode approval gagal");
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "transactions.refund-partial", "Operasi database gagal"),
    );
  }

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
    const costByItemId = new Map<string, { cat: string; cogsPerUnit: number; cogsTotal: number; pricePerUnit: number; qty: number }>();
    for (const it of itemRows) {
      costByItemId.set(it.id, {
        cat: it.itemCategoryName,
        cogsPerUnit: it.quantity > 0 ? Number(it.cogs ?? 0) / it.quantity : 0,
        cogsTotal: Number(it.cogs ?? 0),
        pricePerUnit: it.quantity > 0 ? Number(it.subtotal) / it.quantity : 0,
        qty: it.quantity,
      });
    }
    /* Cap kumulatif COGS reversal di stamped item cogs. cogsPerUnit float
     * + Math.round per refund event → across multiple partial refunds sum
     * reversal bisa exceed stamped cogs beberapa rupiah (mis. cogs=11
     * qty=3 → 3× round(11/3)=12 > 11). Rekonstruksi reversal event-event
     * sebelumnya (formula round(cogsPerUnit×qty) deterministik sama) dari
     * refund_event_items, lalu reversal event INI di-cap ke sisa
     * (stamped cogs − prior reversed). */
    const priorRefundRows = await db
      .select({
        transactionItemId: refundEventItems.transactionItemId,
        quantityRefunded: refundEventItems.quantityRefunded,
      })
      .from(refundEventItems)
      .innerJoin(
        refundEvents,
        eq(refundEventItems.refundEventId, refundEvents.id),
      )
      .where(
        and(
          eq(refundEvents.transactionId, result.transaction.id),
          ne(refundEventItems.refundEventId, result.eventId),
        ),
      );
    const priorReversedByItem = new Map<string, number>();
    for (const r of priorRefundRows) {
      const meta = costByItemId.get(r.transactionItemId);
      if (!meta) continue;
      priorReversedByItem.set(
        r.transactionItemId,
        (priorReversedByItem.get(r.transactionItemId) ?? 0) +
          Math.round(meta.cogsPerUnit * r.quantityRefunded),
      );
    }
    // computation.perItem berisi quantityRefunded + amountRefunded per item.
    // Aggregate by category untuk feed mapPosRefund.
    const aggMap = new Map<string, { amount: number; cogs: number }>();
    for (const p of computation.perItem) {
      const meta = costByItemId.get(p.transactionItemId);
      if (!meta) continue;
      const cur = aggMap.get(meta.cat) ?? { amount: 0, cogs: 0 };
      cur.amount += p.amountRefunded;
      const priorReversed = Math.min(
        priorReversedByItem.get(p.transactionItemId) ?? 0,
        meta.cogsTotal,
      );
      cur.cogs += Math.max(
        0,
        Math.min(
          Math.round(meta.cogsPerUnit * p.quantityRefunded),
          meta.cogsTotal - priorReversed,
        ),
      );
      aggMap.set(meta.cat, cur);
    }
    const aggItems = Array.from(aggMap.entries()).map(([cat, v]) => ({
      itemCategoryName: cat,
      amount: v.amount,
      cogs: v.cogs,
    }));
    const partialRefundArgs = {
      outletId: session.user.outletId,
      transactionId: result.transaction.id,
      refundEventId: result.eventId,
      refundedAmount: computation.totalRefunded,
      items: aggItems,
      reverseCogs: true,
      actorId: session.user.id,
    };
    fireJournalHook(
      () => postJournalForPosRefund(partialRefundArgs),
      "pos_refund_partial",
      {
        sourceId: result.eventId,
        outletId: session.user.outletId,
        actorId: session.user.id,
      },
      { label: "pos_refund", args: partialRefundArgs },
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

  /* Sesi AE-221 — compliment di OPEN BILL ikut dijaga PIN statis.
   * Tanpa ini ada celah: kasir menyimpan bill biasa, lalu meng-edit-nya jadi
   * compliment 100% — createTransaction sudah dijaga, jalur edit belum. */
  const editIsCompliment = (v.discountReason ?? "").startsWith("Compliment:");
  if (editIsCompliment && session.user.role !== "owner") {
    const pinOk = await verifyComplimentPinForOutlet(
      session.user.outletId,
      v.complimentPin,
    );
    if (!pinOk) {
      return fail(
        "COMPLIMENT_PIN_INVALID",
        "PIN compliment salah atau belum diatur Owner",
      );
    }
  }

  // Sesi AE-62k — defer approver token consumption sampai sebelum tx.
  // Sebelumnya: token di-consume sebelum validasi & lock check → kalau
  // edit gagal di tx (mis. stock error, race), approver token sudah burnt
  // tapi edit tidak applied → staff harus minta approver token baru +
  // audit log shows token consumed without effect.
  //
  // Permission check tetap di sini (cheap), token consumption deferred.
  // AE-208/AE-221 — compliment punya gerbang PIN-nya sendiri, bukan PIN
  // approver (lihat catatan di createTransaction). Tanpa pengecualian ini
  // kasir tidak pernah bisa menutup/menyimpan open bill yang di-compliment.
  const editNeedsPinApprover = requiresPinApprover({
    discountAmount: v.discountAmount,
    role: session.user.role,
    isCompliment: editIsCompliment,
  });
  if (editNeedsPinApprover) {
    if (!v.discountApproverToken) {
      return fail(
        "APPROVER_REQUIRED",
        "Staff butuh approver untuk apply discount",
      );
    }
  }
  if (
    v.discountAmount > 0 &&
    session.user.role !== "staff" &&
    !editIsCompliment
  ) {
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
        .select({
          id: transactions.id,
          status: transactions.status,
          /* Sesi AE-62x — defer-stock discriminator (lihat saveAsOpenBill).
           * NULL = open bill baru, stock belum di-deduct → skip restore +
           * skip re-deduct. Non-NULL = legacy bill yang sudah ke-deduct →
           * restore old + deduct new (perilaku lama). */
          stockDeductedAt: transactions.stockDeductedAt,
        })
        .from(transactions)
        .where(eq(transactions.id, v.transactionId))
        .for("update")
        .limit(1);
      if (!locked) throw new Error("NOT_FOUND");
      if (locked.status !== "open") throw new Error("TRX_NOT_OPEN");

      // Sesi AE-62k → AE-62v fix — consume approver token INSIDE tx via `tx`
      // executor parameter. Sebelumnya (AE-62k) panggil pakai `db` global
      // dari dalam tx callback, padahal `db.insert` pakai pool connection
      // yang berbeda — consume tetap auto-committed di luar outer tx →
      // orphan kalau outer rollback. AE-62v: pass `tx` ke consumeApproverToken
      // supaya insert atomic dengan outer tx.
      if (editNeedsPinApprover) {
        try {
          const consumed = await consumeApproverToken(
            v.discountApproverToken!,
            "pos.discount.apply",
            null,
            tx,
          );
          discountApproverId = consumed.approverId;
        } catch (e) {
          throw new Error(
            `APPROVER_TOKEN_INVALID:${e instanceof Error ? e.message : "Token gagal"}`,
          );
        }
      }

      // Step 1: Sesi AE-62x — restore stock HANYA kalau sebelumnya di-deduct
      // (legacy bill pre-AE-62x). Defer-mode bill (stockDeductedAt NULL)
      // tidak punya inventory_movement untuk di-restore.
      if (locked.stockDeductedAt !== null) {
        await restoreStockForTransaction(
          tx,
          session.user.outletId,
          session.user.id,
          v.transactionId,
          "edit_restore",
        );
      }

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

      /* Sesi AE-155 — invalidate prior split_payments saat items berubah.
       * Skenario: customer bayar Rp 50.000 cash (open bill total Rp 100.000),
       * lalu staff tambah item baru → total naik jadi Rp 150.000. Sisa
       * pembayaran harus dihitung ulang dari 0, bukan dari prior split,
       * supaya kasir clear-slate dan tidak salah hitung.
       *
       * Strategy: hard delete prior split rows. Aman karena bill status
       * masih "open" (uncommitted ke buku besar). Audit trail edit di-track
       * via existing edit audit log. Untuk paid bill (split sudah final),
       * editOpenBill block via TRX_NOT_OPEN guard di atas. */
      await tx
        .delete(splitPayments)
        .where(eq(splitPayments.transactionId, v.transactionId));

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
      /* Sesi AE-154 perf — pakai batch helper (sama yg dipakai void +
       * refund). Sebelumnya for-loop sequential = N round-trip (~50ms each).
       * Batch CASE statement = 1 RTT. Plus delete promo_usages parallel
       * dengan batch decrement. */
      if (existingUsages.length > 0) {
        await Promise.all([
          batchDecrementPromoUses(tx, existingUsages),
          tx
            .delete(promoUsages)
            .where(eq(promoUsages.transactionId, v.transactionId)),
        ]);
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

      /* Sesi AE-62x — apply stock deduction HANYA kalau legacy bill
       * (stock sudah ke-deduct sebelumnya, perlu re-deduct setelah edit).
       * Defer-mode bill (NULL): closeOpenBill akan deduct nanti dengan
       * items terbaru. COGS snapshot di transaction_items.cogs sudah
       * di-update di loop atas, jadi report tetap akurat. */
      if (locked.stockDeductedAt !== null) {
        await applyStockDeductions(
          tx,
          session.user.outletId,
          session.user.id,
          v.transactionId,
          flow,
        );
      }

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
    /* Sesi AE-196/AE-221 — PIN compliment WAJIB ikut diteruskan. Tanpa baris
     * ini kasir yang menyimpan compliment sebagai open bill selalu ditolak
     * gerbang compliment, padahal PIN-nya sudah benar di layar. */
    complimentPin: input.complimentPin,
    promoId: input.promoId ?? null,
  };
  // Skip earn here — bill not yet paid. closeOpenBill fires earn when the
  // bill actually transitions to status="paid".
  //
  // Sesi AE-62x — deferStock=true: open bill TIDAK deduct ingredient stock.
  // closeOpenBill akan deduct saat bayar. cancelOpenBill skip restore
  // (tidak ada yang perlu di-restore). Mengurangi phantom stock loss kalau
  // bill abandoned & kasir lupa cancel.
  const created = await createTransaction(placeholder, {
    skipEarn: true,
    deferStock: true,
  });
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
  runAfterResponse(() =>
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
    }), "audit-open-bill");

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

  /* Sesi AE-131 perf — capture final state INSIDE tx supaya tidak perlu
   * blocking refetch setelah commit (lihat akhir fn). Saves 3 RTT
   * (≈300-500ms) per close action — customer-facing pain point. */
  let finalPaymentMethod: TransactionWithItems["paymentMethod"] =
    input.paymentMethod;
  let finalCashReceived: number | null = null;
  let finalCashChange: number | null = null;
  let finalStockDeductedAt: Date | null = null;
  const finalUpdatedAt = new Date();

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
          /* Sesi AE-62x — discriminator: NULL = defer mode, perlu deduct
           * sekarang. Non-NULL = legacy bill yang sudah ke-deduct saat
           * saveAsOpenBill lama (atau direct sale path), skip re-deduct. */
          stockDeductedAt: transactions.stockDeductedAt,
        })
        .from(transactions)
        .where(eq(transactions.id, input.transactionId))
        .for("update")
        .limit(1);
      if (!locked) throw new Error("NOT_FOUND");
      if (locked.status !== "open") throw new Error("TRX_NOT_OPEN");

      /* Sesi AE-62x — Defer Stock: kalau stock belum di-deduct (open bill
       * baru AE-62x+), lakukan deduct sekarang dengan items snapshot from
       * transaction_items. Recipe cost di-recompute pakai ingredient cost
       * SEKARANG (di close time) — kasir/customer-visible total tidak
       * berubah, tapi COGS-side jadi reflect cost saat ingredient actually
       * dipakai (mirip direct sale). */
      // Sesi AE-173 — mode periodic: tetap hitung & stamp COGS, tapi TIDAK
      // deduct stok; biarkan stock_deducted_at NULL (lihat stockDeductedAtFinal).
      const { deductOnSale: closeDeductOnSale } = await getStockMode(
        session.user.outletId,
        tx,
      );
      if (locked.stockDeductedAt === null) {
        const itemsForClose = await tx
          .select({
            id: transactionItemsSchema.id,
            menuItemId: transactionItemsSchema.menuItemId,
            variant: transactionItemsSchema.variant,
            quantity: transactionItemsSchema.quantity,
          })
          .from(transactionItemsSchema)
          .where(eq(transactionItemsSchema.transactionId, input.transactionId));
        if (itemsForClose.length > 0) {
          const flow = await computeStockFlowForOrder(
            tx,
            session.user.outletId,
            itemsForClose.map((it) => ({
              transactionItemId: it.id,
              menuItemId: it.menuItemId,
              variant: it.variant,
              quantity: it.quantity,
            })),
          );
          if (closeDeductOnSale) {
            await applyStockDeductions(
              tx,
              session.user.outletId,
              session.user.id,
              input.transactionId,
              flow,
            );
          }
          /* Patch trx.cogs + per-item cogs juga di sini supaya report COGS
           * accurate dengan ingredient cost saat actual deduction. */
          const hasAnyCogs =
            flow.itemsWithoutRecipe.length < itemsForClose.length;
          if (hasAnyCogs) {
            await tx
              .update(transactions)
              .set({ cogs: flow.totalCogs })
              .where(eq(transactions.id, input.transactionId));
          }
          const cogsPatches = itemsForClose
            .map((ti) => ({
              id: ti.id,
              cogs: flow.itemCogsByTrxItemId.get(ti.id),
            }))
            .filter(
              (p): p is { id: string; cogs: number } =>
                p.cogs !== undefined && p.cogs > 0,
            );
          if (cogsPatches.length > 0) {
            await Promise.all(
              cogsPatches.map((p) =>
                tx
                  .update(transactionItemsSchema)
                  .set({ cogs: p.cogs })
                  .where(eq(transactionItemsSchema.id, p.id)),
              ),
            );
          }
        }
      }

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

      /* Sesi AE-131 — derive final stockDeductedAt sekali, reuse di kedua
       * branch + capture untuk return state (skip blocking refetch).
       * Sesi AE-173 — mode periodic (closeDeductOnSale=false): tidak ada
       * deduksi, jadi stamp tetap NULL supaya void/refund restore = no-op. */
      const stockDeductedAtFinal =
        locked.stockDeductedAt === null
          ? closeDeductOnSale
            ? finalUpdatedAt
            : null
          : locked.stockDeductedAt;

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
            stockDeductedAt: stockDeductedAtFinal,
            updatedAt: finalUpdatedAt,
          })
          .where(eq(transactions.id, input.transactionId));
        finalPaymentMethod = "split";
        finalCashReceived = null;
        finalCashChange = null;
        finalStockDeductedAt = stockDeductedAtFinal;
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
            stockDeductedAt: stockDeductedAtFinal,
            updatedAt: finalUpdatedAt,
          })
          .where(eq(transactions.id, input.transactionId));
        finalPaymentMethod = input.paymentMethod;
        finalCashReceived =
          input.paymentMethod === "cash" ? input.cashReceived : null;
        finalCashChange =
          input.paymentMethod === "cash" ? freshCashChange : null;
        finalStockDeductedAt = stockDeductedAtFinal;
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
    runAfterResponse(
      () => earnPointsForTransaction(input.transactionId),
      "loyalty-earn-close",
    );
  }

  /* Sesi T — Accounting auto-journal hook (open bill → paid). Fire here, NOT
   * di saveAsOpenBill (which calls createTransaction with skipEarn=true).
   * sesi AD-11: hoisted to static import.
   *
   * Sesi AE-76 — sebelumnya fire tanpa context + retrySpec, jadi kalau
   * journal post gagal: audit log YA tapi retry queue TIDAK → owner cuma
   * lihat audit error, tidak bisa retry dari UI. Sekarang lengkap context
   * + retrySpec sama dengan createTransaction path (line 840). */
  const closePosSaleArgs = {
    outletId: session.user.outletId,
    transactionId: input.transactionId,
    actorId: session.user.id,
  };
  fireJournalHook(
    () => postJournalForPosSale(closePosSaleArgs),
    "pos_sale_open_bill_close",
    {
      sourceId: input.transactionId,
      outletId: session.user.outletId,
      actorId: session.user.id,
    },
    { label: "pos_sale", args: closePosSaleArgs },
  );

  /* Sesi AE-131 perf — skip fetchTransactionById (yang trigger 3 round-trips:
   * trx + items + mods + customer). State sudah captured INSIDE tx, items +
   * modifiers di `current` masih akurat (close hanya ubah header fields).
   * Saves ~300-500ms per close, customer-facing pain point. */
  return ok({
    ...current,
    status: "paid",
    paymentMethod: finalPaymentMethod,
    cashReceived: finalCashReceived,
    cashChange: finalCashChange,
    stockDeductedAt: finalStockDeductedAt,
    updatedAt: finalUpdatedAt,
  });
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
  let stockWasDeducted = false;
  try {
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          id: transactions.id,
          status: transactions.status,
          outletId: transactions.outletId,
          /* Sesi AE-62x — kalau NULL (defer mode, open bill AE-62x+),
           * skip restoreStockForTransaction karena stock TIDAK pernah
           * di-deduct. Kalau non-NULL (legacy pre-AE-62x open bill),
           * restore dengan flow lama. */
          stockDeductedAt: transactions.stockDeductedAt,
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
      stockWasDeducted = locked.stockDeductedAt !== null;

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

      // Sesi AE-62x — restore stock HANYA kalau sebelumnya di-deduct
      // (legacy bill). Defer-mode bill (stockDeductedAt NULL) no-op.
      let restored: string[] = [];
      if (locked.stockDeductedAt !== null) {
        restored = await restoreStockForTransaction(
          tx,
          session.user.outletId,
          session.user.id,
          v.transactionId,
          "void_restore",
        );
      }

      // Restore loyalty points (kalau ada redeem) + claw back earned.
      // For open bill, earn TIDAK fired di saveAsOpenBill (skipEarn=true),
      // tapi redeem mungkin terjadi → restore those.
      const { restorePointsOnTransactionRefund } = await import(
        "@/features/customers/loyalty-internal"
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
      /* Sesi AE-131 perf — batch decrement. */
      await batchDecrementPromoUses(tx, promoUsageRows);

      return { updated: updatedRow, restoredIds: restored };
    });
    updated = result.updated;
    restoredIngredientIds = result.restoredIds;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
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
    runAfterResponse(
      () => reevaluateSoldOutForIngredients(restoredIngredientIds),
      "sold-out-cancel-open-bill",
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

  /* Sesi AE-160c — Fire reverse journal hook kalau stock pernah ter-deducted
   * (legacy pre-AE-62x open bill). Tanpa ini, COGS yang sudah ter-post di
   * sale-time journal tidak ter-reverse → GL drift permanent.
   *
   * Defer-mode bill (stockDeductedAt NULL, pattern post-AE-62x) tidak fire
   * journal hook karena memang belum pernah post pos_sale → tidak ada yang
   * perlu di-reverse. */
  if (stockWasDeducted) {
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
    const posVoidArgs = {
      outletId: session.user.outletId,
      transactionId: v.transactionId,
      items: aggItems,
      actorId: session.user.id,
    };
    fireJournalHook(
      () => postJournalForPosVoid(posVoidArgs),
      "pos_void",
      {
        sourceId: v.transactionId,
        outletId: session.user.outletId,
        actorId: session.user.id,
      },
      { label: "pos_void_cancel_open_bill", args: posVoidArgs },
    );
  }

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
  runAfterResponse(() =>
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
    }), "audit-split");

  // Loyalty earn — only when this split closes the bill.
  if (newTotalPaid >= current.total && current.customerId !== null) {
    runAfterResponse(
      () => earnPointsForTransaction(v.transactionId),
      "loyalty-earn-split",
    );
  }

  const refreshed = await fetchTransactionById(v.transactionId);
  return refreshed
    ? ok(refreshed)
    : fail("DB_ERROR", "Gagal fetch transaksi setelah split");
}
