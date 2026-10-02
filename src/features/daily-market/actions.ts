"use server";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  dailyMarketEntries,
  expenseCategories,
  ingredients,
  users,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { recordJournal } from "@/features/accounting/posting";
import { resolveExpenseAccountCode } from "@/features/accounting/hooks";
import { resolveBankCodeFromBankName } from "@/features/accounting/mapping/dividendWithdrawal";
import {
  mapDailyMarketSpend,
  mapDailyMarketTopup,
  reverseDailyMarketLines,
} from "@/features/accounting/mapping/dailyMarket";
import { normalizeReceiptUrl } from "@/features/accounting/receipt-url";
import { startOfWibDateUtc, todayWibIso } from "@/features/cash/helpers";
import { reverseSchema, spendSchema, topupSchema } from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type DailyMarketEntryRow,
  type DailyMarketSummary,
  type ReverseInput,
  type SpendInput,
  type TopupInput,
} from "./types";

/**
 * Sesi AE-242 — Belanja Daily Market (uang muka kurir).
 *
 * Saldo kurir TIDAK disimpan di tabel ini; saldonya adalah saldo akun 1103 di
 * buku besar. Ringkasan di layar dihitung dari baris berstatus `posted`, dan
 * angka itu memang harus sama dengan saldo 1103 di Buku Kas — kalau suatu
 * saat beda, jurnalnya yang bermasalah, bukan layarnya.
 *
 * Jurnal diposting SINKRON di dalam transaksi (pola internal-debts/creditors),
 * bukan hook fire-and-forget: uang muka yang tercatat tanpa jurnal akan
 * membuat saldo bank dan saldo kurir sama-sama bohong.
 */

async function requireSession() {
  const s = await auth();
  if (!s) throw new Error("UNAUTHORIZED");
  return s;
}

/* Izin memakai gerbang yang sudah ada: mencatat = sama dengan mencatat
 * pengeluaran kas; membatalkan jurnal = owner saja. */
const CAN_WRITE = "expense.create" as const;
const CAN_REVERSE = "expense.delete" as const;

function bankLabelOf(b: {
  bankName: string;
  accountName: string;
  accountNumber: string | null;
}): string {
  const tail =
    b.accountNumber && b.accountNumber.length > 4
      ? `...${b.accountNumber.slice(-4)}`
      : (b.accountNumber ?? "");
  return [b.bankName, b.accountName, tail].filter(Boolean).join(" — ");
}

// ============================================================ reads =========

export async function listDailyMarketEntries(opts?: {
  limit?: number;
}): Promise<ApiResult<DailyMarketEntryRow[]>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi berakhir, silakan login ulang");

  const rows = await db
    .select({
      e: dailyMarketEntries,
      bankName: bankAccounts.bankName,
      accountName: bankAccounts.accountName,
      accountNumber: bankAccounts.accountNumber,
      categoryName: expenseCategories.name,
      createdByName: users.name,
    })
    .from(dailyMarketEntries)
    .leftJoin(bankAccounts, eq(bankAccounts.id, dailyMarketEntries.bankAccountId))
    .leftJoin(
      expenseCategories,
      eq(expenseCategories.id, dailyMarketEntries.categoryId),
    )
    .leftJoin(users, eq(users.id, dailyMarketEntries.createdBy))
    .where(
      and(
        eq(dailyMarketEntries.outletId, session.user.outletId),
        isNull(dailyMarketEntries.deletedAt),
      ),
    )
    .orderBy(desc(dailyMarketEntries.entryDate), desc(dailyMarketEntries.createdAt))
    .limit(Math.min(opts?.limit ?? 200, 1000));

  /* Nama bahan di-resolve sekali untuk SEMUA baris, bukan per baris:
   * daftar ini bisa ratusan baris dan tiap barisnya punya beberapa bahan. */
  const allIds = [
    ...new Set(
      rows.flatMap((r) =>
        Array.isArray(r.e.ingredientIds) ? (r.e.ingredientIds as string[]) : [],
      ),
    ),
  ];
  const nameById = new Map<string, string>();
  if (allIds.length > 0) {
    const ings = await db
      .select({ id: ingredients.id, name: ingredients.name })
      .from(ingredients)
      .where(inArray(ingredients.id, allIds));
    for (const i of ings) nameById.set(i.id, i.name);
  }

  return ok(
    rows.map((r) => ({
      ...r.e,
      ingredientNames: (Array.isArray(r.e.ingredientIds)
        ? (r.e.ingredientIds as string[])
        : []
      ).map((id) => nameById.get(id) ?? "(bahan dihapus)"),
      bankLabel: r.bankName
        ? bankLabelOf({
            bankName: r.bankName,
            accountName: r.accountName ?? "",
            accountNumber: r.accountNumber,
          })
        : null,
      categoryName: r.categoryName ?? null,
      createdByName: r.createdByName ?? null,
    })),
  );
}

export async function getDailyMarketSummary(): Promise<
  ApiResult<DailyMarketSummary>
> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi berakhir, silakan login ulang");

  const [row] = await db
    .select({
      totalTopup: sql<number>`coalesce(sum(case when ${dailyMarketEntries.kind} = 'topup' then ${dailyMarketEntries.amount} else 0 end), 0)::bigint`,
      totalSpend: sql<number>`coalesce(sum(case when ${dailyMarketEntries.kind} = 'spend' then ${dailyMarketEntries.amount} else 0 end), 0)::bigint`,
      entryCount: sql<number>`count(*)::int`,
    })
    .from(dailyMarketEntries)
    .where(
      and(
        eq(dailyMarketEntries.outletId, session.user.outletId),
        isNull(dailyMarketEntries.deletedAt),
        eq(dailyMarketEntries.status, "posted"),
      ),
    );

  const totalTopup = Number(row?.totalTopup ?? 0);
  const totalSpend = Number(row?.totalSpend ?? 0);
  return ok({
    totalTopup,
    totalSpend,
    balance: totalTopup - totalSpend,
    entryCount: Number(row?.entryCount ?? 0),
  });
}

// =========================================================== writes =========

/** Top up ke kurir — uang keluar dari rekening bank, masuk saldo kurir. */
export async function postDailyMarketTopup(
  input: TopupInput,
): Promise<ApiResult<{ id: string; journalEntryId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, CAN_WRITE)) {
    return fail("FORBIDDEN", "Tidak punya hak mencatat top up kurir");
  }
  const parsed = topupSchema.safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail("VALIDATION", i?.message ?? "Input tidak valid", String(i?.path?.[0] ?? ""));
  }
  const v = parsed.data;

  const [bank] = await db
    .select({
      id: bankAccounts.id,
      outletId: bankAccounts.outletId,
      bankName: bankAccounts.bankName,
      accountName: bankAccounts.accountName,
      accountNumber: bankAccounts.accountNumber,
      isActive: bankAccounts.isActive,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, v.bankAccountId))
    .limit(1);
  if (!bank) return fail("NOT_FOUND", "Rekening tidak ditemukan");
  if (bank.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Rekening dari outlet lain");
  }
  if (!bank.isActive) return fail("BANK_INACTIVE", "Rekening non-aktif");

  const entryDate = v.entryDate ?? todayWibIso();
  const bankLabel = bankLabelOf(bank);
  const description =
    v.description?.trim() || `Top up belanja daily market — ${v.courierName}`;

  try {
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(dailyMarketEntries)
        .values({
          outletId: session.user.outletId,
          kind: "topup",
          entryDate,
          occurredAt: startOfWibDateUtc(entryDate),
          amount: v.amount,
          description,
          courierName: v.courierName,
          bankAccountId: bank.id,
          receiptImageUrl: normalizeReceiptUrl(v.receiptImageUrl ?? null),
          createdBy: session.user.id,
        })
        .returning();

      const journal = await recordJournal({
        outletId: session.user.outletId,
        entryDate,
        description: `${description} (${bankLabel})`,
        sourceType: "daily_market_topup",
        sourceId: row.id,
        lines: mapDailyMarketTopup({
          amount: v.amount,
          bankAccountCode: resolveBankCodeFromBankName(bank.bankName),
          bankLabel,
          courierName: v.courierName,
        }),
        status: "posted",
        actorId: session.user.id,
        receiptImageUrl: normalizeReceiptUrl(v.receiptImageUrl ?? null),
        metadata: { courierName: v.courierName, bankAccountId: bank.id },
      });

      await tx
        .update(dailyMarketEntries)
        .set({ journalEntryId: journal.entryId })
        .where(eq(dailyMarketEntries.id, row.id));

      return { id: row.id, journalEntryId: journal.entryId };
    });

    logAudit({
      eventType: "daily_market.topup",
      userId: session.user.id,
      entityType: "daily_market_entry",
      entityId: result.id,
      payload: {
        summary: `Top up kurir ${v.courierName} Rp ${v.amount.toLocaleString("id-ID")} dari ${bankLabel}`,
        after: { amount: v.amount, courierName: v.courierName, entryDate },
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    }).catch((e) => console.error("[audit daily_market.topup]", e));

    return ok(result);
  } catch (e) {
    return fail("DB_ERROR", e instanceof Error ? e.message : "Gagal menyimpan top up");
  }
}

/** Belanja kurir — memakai saldo yang sudah ditransfer, bukan kas outlet. */
export async function postDailyMarketSpend(
  input: SpendInput,
): Promise<ApiResult<{ id: string; journalEntryId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, CAN_WRITE)) {
    return fail("FORBIDDEN", "Tidak punya hak mencatat belanja kurir");
  }
  const parsed = spendSchema.safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail("VALIDATION", i?.message ?? "Input tidak valid", String(i?.path?.[0] ?? ""));
  }
  const v = parsed.data;

  const [cat] = await db
    .select({ id: expenseCategories.id, outletId: expenseCategories.outletId })
    .from(expenseCategories)
    .where(eq(expenseCategories.id, v.categoryId))
    .limit(1);
  if (!cat) return fail("NOT_FOUND", "Kategori tidak ditemukan");
  if (cat.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Kategori dari outlet lain");
  }

  /* Rem saldo: belanja tidak boleh melebihi uang yang pernah ditransfer.
   * Tanpa ini saldo 1103 jadi minus — artinya kurir "menghabiskan" uang yang
   * belum pernah dikirim, dan neraca ikut salah tanpa ada yang menyadarinya. */
  const summary = await getDailyMarketSummary();
  if (!summary.success) return summary;
  if (v.amount > summary.data.balance) {
    return fail(
      "INSUFFICIENT_BALANCE",
      `Belanja Rp ${v.amount.toLocaleString("id-ID")} melebihi saldo kurir Rp ${summary.data.balance.toLocaleString("id-ID")}. Top up dulu.`,
      "amount",
    );
  }

  const entryDate = v.entryDate ?? todayWibIso();
  const expenseAccountCode = await resolveExpenseAccountCode(
    session.user.outletId,
    null,
    v.categoryId,
  );

  try {
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(dailyMarketEntries)
        .values({
          outletId: session.user.outletId,
          kind: "spend",
          entryDate,
          occurredAt: startOfWibDateUtc(entryDate),
          amount: v.amount,
          description: v.description,
          courierName: v.courierName,
          categoryId: v.categoryId,
          ingredientIds: v.ingredientIds?.length ? v.ingredientIds : null,
          receiptImageUrl: normalizeReceiptUrl(v.receiptImageUrl ?? null),
          createdBy: session.user.id,
        })
        .returning();

      const journal = await recordJournal({
        outletId: session.user.outletId,
        entryDate,
        description: `Belanja daily market: ${v.description}`,
        sourceType: "daily_market_spend",
        sourceId: row.id,
        lines: mapDailyMarketSpend({
          amount: v.amount,
          expenseAccountCode,
          description: v.description,
          courierName: v.courierName,
        }),
        status: "posted",
        actorId: session.user.id,
        receiptImageUrl: normalizeReceiptUrl(v.receiptImageUrl ?? null),
        metadata: {
          courierName: v.courierName,
          categoryId: v.categoryId,
          expenseAccountCode,
          ingredientIds: v.ingredientIds ?? [],
        },
      });

      await tx
        .update(dailyMarketEntries)
        .set({ journalEntryId: journal.entryId })
        .where(eq(dailyMarketEntries.id, row.id));

      return { id: row.id, journalEntryId: journal.entryId };
    });

    logAudit({
      eventType: "daily_market.spend",
      userId: session.user.id,
      entityType: "daily_market_entry",
      entityId: result.id,
      payload: {
        summary: `Belanja daily market ${v.courierName} Rp ${v.amount.toLocaleString("id-ID")}: ${v.description}`,
        after: { amount: v.amount, expenseAccountCode, entryDate },
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    }).catch((e) => console.error("[audit daily_market.spend]", e));

    return ok(result);
  } catch (e) {
    return fail("DB_ERROR", e instanceof Error ? e.message : "Gagal menyimpan belanja");
  }
}

/** Batalkan satu catatan — jurnalnya dibalik, barisnya ditandai reversed. */
export async function reverseDailyMarketEntry(
  input: ReverseInput,
): Promise<ApiResult<{ reversalEntryId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, CAN_REVERSE)) {
    return fail("FORBIDDEN", "Hanya Owner yang bisa membatalkan catatan ini");
  }
  const parsed = reverseSchema.safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail("VALIDATION", i?.message ?? "Input tidak valid");
  }
  const v = parsed.data;

  const [row] = await db
    .select()
    .from(dailyMarketEntries)
    .where(eq(dailyMarketEntries.id, v.id))
    .limit(1);
  if (!row) return fail("NOT_FOUND", "Catatan tidak ditemukan");
  if (row.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Catatan dari outlet lain");
  }
  if (row.status === "reversed") {
    return fail("ALREADY_REVERSED", "Catatan ini sudah dibatalkan");
  }

  /* Membatalkan TOP UP akan menarik kembali saldo kurir. Kalau saldonya
   * sudah terlanjur dibelanjakan, pembatalan membuat 1103 minus — jadi
   * ditolak, dan yang harus dibatalkan lebih dulu adalah belanjanya. */
  if (row.kind === "topup") {
    const summary = await getDailyMarketSummary();
    if (!summary.success) return summary;
    if (row.amount > summary.data.balance) {
      return fail(
        "BALANCE_ALREADY_SPENT",
        `Top up ini sudah terpakai belanja. Sisa saldo tinggal Rp ${summary.data.balance.toLocaleString("id-ID")} — batalkan belanjanya dulu.`,
      );
    }
  }

  /* Baris jurnal asal disusun ulang dari template yang sama lalu ditukar
   * sisinya, bukan dibaca dari journal_lines: nilainya pasti sepasang dan
   * tidak ikut berubah kalau jurnal lamanya pernah disunting. */
  let lines;
  if (row.kind === "topup") {
    const [bank] = await db
      .select({
        bankName: bankAccounts.bankName,
        accountName: bankAccounts.accountName,
        accountNumber: bankAccounts.accountNumber,
      })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, row.bankAccountId!))
      .limit(1);
    if (!bank) return fail("NOT_FOUND", "Rekening asal tidak ditemukan");
    lines = reverseDailyMarketLines(
      mapDailyMarketTopup({
        amount: row.amount,
        bankAccountCode: resolveBankCodeFromBankName(bank.bankName),
        bankLabel: bankLabelOf(bank),
        courierName: row.courierName ?? "kurir",
      }),
    );
  } else {
    const expenseAccountCode = await resolveExpenseAccountCode(
      session.user.outletId,
      null,
      row.categoryId!,
    );
    lines = reverseDailyMarketLines(
      mapDailyMarketSpend({
        amount: row.amount,
        expenseAccountCode,
        description: row.description,
        courierName: row.courierName ?? "kurir",
      }),
    );
  }

  try {
    const reversalEntryId = await db.transaction(async (tx) => {
      const journal = await recordJournal({
        outletId: session.user.outletId,
        entryDate: todayWibIso(),
        description: `Pembalik ${row.kind === "topup" ? "top up" : "belanja"} daily market — ${v.reason}`,
        sourceType:
          row.kind === "topup"
            ? "daily_market_topup_reversal"
            : "daily_market_spend_reversal",
        sourceId: row.id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: { reversedEntryId: row.id, reason: v.reason },
      });

      await tx
        .update(dailyMarketEntries)
        .set({
          status: "reversed",
          reversedAt: new Date(),
          reversedBy: session.user.id,
          reversalReason: v.reason,
          updatedAt: new Date(),
        })
        .where(eq(dailyMarketEntries.id, row.id));

      return journal.entryId;
    });

    logAudit({
      eventType: "daily_market.reverse",
      userId: session.user.id,
      entityType: "daily_market_entry",
      entityId: row.id,
      payload: {
        summary: `Batalkan ${row.kind === "topup" ? "top up" : "belanja"} daily market Rp ${row.amount.toLocaleString("id-ID")}: ${v.reason}`,
        after: { status: "reversed", reason: v.reason },
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    }).catch((e) => console.error("[audit daily_market.reverse]", e));

    return ok({ reversalEntryId });
  } catch (e) {
    return fail("DB_ERROR", e instanceof Error ? e.message : "Gagal membatalkan");
  }
}
