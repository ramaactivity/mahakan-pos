"use server";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  dailyMarketEntries,
  dailyMarketItems,
  expenseCategories,
  ingredientCostHistory,
  ingredients,
  inventoryMovements,
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
  type DailyMarketInventoryLine,
} from "@/features/accounting/mapping/dailyMarket";
import type { IngredientSection } from "@/features/accounting/mapping/purchase";
import { normalizeReceiptUrl } from "@/features/accounting/receipt-url";
import { startOfWibDateUtc, todayWibIso } from "@/features/cash/helpers";
import { getStockMode } from "@/features/inventory/flag";
import { fetchLastFinalizedOpname } from "@/features/stock-opname/queries";
import { computeNewWac } from "@/features/cogs/cogs-calc";
import { computeNewStock, formatMovementDelta } from "@/lib/stock-decimal";
import {
  classifyPurchaseAgainstOpname,
  resolveQtyToMaster,
  shouldSkipStockUpdate,
  type IngredientPackConversion,
} from "@/lib/unit-conversion";
import { reverseSchema, spendSchema, topupSchema } from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type DailyMarketEntryRow,
  type DailyMarketItemRow,
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

  /* Baris bahan ditarik SEKALI untuk semua entry, bukan per entry: daftar ini
   * bisa ratusan baris dan tiap barisnya punya beberapa bahan. */
  const entryIds = rows.map((r) => r.e.id);
  const itemsByEntry = new Map<string, DailyMarketItemRow[]>();
  if (entryIds.length > 0) {
    const itemRows = await db
      .select({
        i: dailyMarketItems,
        masterUnit: ingredients.unit,
        skipped: inventoryMovements.skippedStockUpdate,
      })
      .from(dailyMarketItems)
      .leftJoin(ingredients, eq(ingredients.id, dailyMarketItems.ingredientId))
      .leftJoin(
        inventoryMovements,
        eq(inventoryMovements.id, dailyMarketItems.movementId),
      )
      .where(inArray(dailyMarketItems.entryId, entryIds));
    for (const r of itemRows) {
      const list = itemsByEntry.get(r.i.entryId) ?? [];
      list.push({
        id: r.i.id,
        ingredientId: r.i.ingredientId,
        name: r.i.nameSnapshot,
        qty: Number(r.i.qty),
        unit: r.i.unit ?? r.i.unitSnapshot,
        qtyMaster: Number(r.i.qtyMaster),
        masterUnit: r.masterUnit ?? r.i.unitSnapshot,
        unitCost: r.i.unitCost,
        subtotal: r.i.subtotal,
        stockSkipped: r.skipped ?? true,
      });
      itemsByEntry.set(r.i.entryId, list);
    }
  }

  return ok(
    rows.map((r) => {
      const items = itemsByEntry.get(r.e.id) ?? [];
      const inventoryTotal = items.reduce((sum, i) => sum + i.subtotal, 0);
      return {
      ...r.e,
      items,
      inventoryTotal,
      /* Sisa nota yang memang bukan barang. Negatif mustahil: nilai bahan
       * sudah ditolak di muka kalau melebihi nominal nota. */
      expenseTotal: Math.max(0, r.e.amount - inventoryTotal),
      bankLabel: r.bankName
        ? bankLabelOf({
            bankName: r.bankName,
            accountName: r.accountName ?? "",
            accountNumber: r.accountNumber,
          })
        : null,
      categoryName: r.categoryName ?? null,
      createdByName: r.createdByName ?? null,
      };
    }),
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
/**
 * Sesi AE-245 — menyiapkan baris bahan nota pasar.
 *
 * Konversi satuan memakai `resolveQtyToMaster`, sumber kebenaran tunggal yang
 * juga dipakai Opname, Pembelian, dan Market List — supaya "1 renceng" berarti
 * hal yang sama di semua modul. Tanpa itu baris GR bisa menyimpan qty satuan
 * BELI dengan label satuan MASTER, jebakan yang pernah membuat layar menulis
 * "Beans 6 gr = Rp 990rb" tanpa error (sesi AE-222).
 */
interface ResolvedMarketItem {
  ingredientId: string;
  name: string;
  masterUnit: string;
  section: IngredientSection;
  qty: number;
  unit: string | null;
  qtyMaster: number;
  unitCost: number;
  unitCostMaster: number;
  subtotal: number;
}

async function resolveMarketItems(
  outletId: string,
  items: NonNullable<SpendInput["items"]>,
): Promise<
  | { ok: true; rows: ResolvedMarketItem[]; total: number }
  | { ok: false; code: string; message: string }
> {
  const ids = [...new Set(items.map((i) => i.ingredientId))];
  const masters = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      section: ingredients.section,
      outletId: ingredients.outletId,
      packConversions: ingredients.packConversions,
      unitBelanja: ingredients.unitBelanja,
      unitBelanjaPerCogs: ingredients.unitBelanjaPerCogs,
    })
    .from(ingredients)
    .where(inArray(ingredients.id, ids));
  const byId = new Map(masters.map((m) => [m.id, m]));

  const rows: ResolvedMarketItem[] = [];
  let total = 0;
  for (const item of items) {
    const m = byId.get(item.ingredientId);
    if (!m) {
      return { ok: false, code: "NOT_FOUND", message: "Ada bahan yang tidak ditemukan di master" };
    }
    if (m.outletId !== outletId) {
      return { ok: false, code: "FORBIDDEN", message: `Bahan "${m.name}" milik outlet lain` };
    }

    const unit = item.unit?.trim() || null;
    const res = resolveQtyToMaster({
      qty: item.qty,
      fromUnit: unit,
      masterUnit: m.unit,
      ingredientPacks: (m.packConversions as IngredientPackConversion[] | null) ?? null,
      unitBelanja: m.unitBelanja,
      unitBelanjaPerCogs: m.unitBelanjaPerCogs,
    });
    /* Satuan yang tidak bisa dikonversi DITOLAK, bukan diam-diam dianggap
     * satuan dasar: menyimpan "2" sebagai 2 gram padahal maksudnya 2 karung
     * adalah kesalahan yang tidak pernah terlihat di layar mana pun. */
    if (!res.ok || res.qtyMaster === null || res.costFactor === null) {
      return {
        ok: false,
        code: "UNIT_UNRESOLVED",
        message: `Satuan "${unit ?? m.unit}" untuk ${m.name} belum dikenal. Daftarkan dulu konversinya di master bahan.`,
      };
    }

    /* AE-216 — TOTAL yang menang. Kalau layar tidak mengirim subtotal, barulah
     * dihitung dari qty × harga satuan. */
    const subtotal = item.subtotal ?? Math.round(item.qty * item.unitCost);
    if (subtotal <= 0) {
      return { ok: false, code: "VALIDATION", message: `Nilai belanja ${m.name} harus lebih dari 0` };
    }

    rows.push({
      ingredientId: m.id,
      name: m.name,
      masterUnit: m.unit,
      section: m.section as IngredientSection,
      qty: item.qty,
      unit,
      qtyMaster: res.qtyMaster,
      unitCost: item.unitCost,
      unitCostMaster: Math.max(0, Math.round(item.unitCost / res.costFactor)),
      subtotal,
    });
    total += subtotal;
  }
  return { ok: true, rows, total };
}

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

  /* Sesi AE-245 — baris bahan. Diresolusi DULU di luar transaksi: kalau
   * satuannya belum dikenal, lebih baik gagal sebelum apa pun tersimpan. */
  const inputItems = v.items ?? [];
  const resolved = inputItems.length
    ? await resolveMarketItems(session.user.outletId, inputItems)
    : ({ ok: true, rows: [], total: 0 } as const);
  if (!resolved.ok) return fail(resolved.code, resolved.message, "items");

  if (resolved.total > v.amount) {
    return fail(
      "ITEMS_EXCEED_AMOUNT",
      `Nilai bahan Rp ${resolved.total.toLocaleString("id-ID")} melebihi nominal nota Rp ${v.amount.toLocaleString("id-ID")}.`,
      "items",
    );
  }

  /* Gerbang stok PERSIS seperti Purchasing — sengaja memanggil helper yang
   * sama, bukan menyalin aturannya. Dua rem: mode periodic (stok hanya dari
   * opname) dan nota bertanggal sebelum opname terakhir (barangnya sudah
   * ikut terhitung di opname itu). */
  const { addOnPurchase } = await getStockMode(session.user.outletId);
  const lastOpname = await fetchLastFinalizedOpname(session.user.outletId);
  const backdated = shouldSkipStockUpdate(
    classifyPurchaseAgainstOpname({
      purchaseDateIso: entryDate,
      lastOpnameFinalizedAt: lastOpname?.finalizedAt ?? null,
    }),
  );
  const skipStockEffect = backdated || !addOnPurchase;

  const inventoryLines: DailyMarketInventoryLine[] = resolved.rows.map((r) => ({
    section: r.section,
    amount: r.subtotal,
  }));

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
          receiptImageUrl: normalizeReceiptUrl(v.receiptImageUrl ?? null),
          createdBy: session.user.id,
        })
        .returning();

      for (const r of resolved.rows) {
        const [ing] = await tx
          .select()
          .from(ingredients)
          .where(eq(ingredients.id, r.ingredientId))
          .for("update")
          .limit(1);
        if (!ing) throw new Error(`INGREDIENT_GONE:${r.name}`);

        const movementDelta = formatMovementDelta(r.qtyMaster);

        if (!skipStockEffect) {
          const newStock = computeNewStock({
            currentBigint: ing.currentStock,
            currentDecimal: ing.currentStockDecimal,
            delta: r.qtyMaster,
          });
          /* WAC dihitung ulang supaya harga pasar ikut membentuk HPP, sama
           * seperti pembelian ke supplier. Hanya kalau stoknya memang
           * bertambah: menaikkan harga tanpa menaikkan qty membuat rumus
           * (nilai lama + nilai baru) / (qty lama + qty baru) tidak konsisten. */
          const wac = computeNewWac({
            oldQty: Number(ing.currentStockDecimal ?? 0),
            oldCost: ing.costPerUnit,
            purchaseQty: r.qtyMaster,
            purchaseTotal: Math.round(r.qtyMaster * r.unitCostMaster),
          });
          await tx
            .update(ingredients)
            .set({
              currentStock: newStock.bigint,
              currentStockDecimal: newStock.decimal,
              costPerUnit: wac.newCost,
              ...(wac.newCost !== ing.costPerUnit
                ? { costLastChangedAt: new Date() }
                : {}),
              updatedAt: new Date(),
              updatedBy: session.user.id,
            })
            .where(eq(ingredients.id, r.ingredientId));

          if (wac.newCost !== ing.costPerUnit) {
            await tx.insert(ingredientCostHistory).values({
              outletId: session.user.outletId,
              ingredientId: r.ingredientId,
              oldCostPerUnit: ing.costPerUnit,
              newCostPerUnit: wac.newCost,
              triggerType: "purchase_wac",
              /* Bukan "purchase": id-nya milik daily_market_entries, dan
               * penelusur yang mencarinya di tabel purchases akan buntu. */
              triggerRefType: "daily_market",
              triggerRefId: row.id,
              changedQty: r.qtyMaster.toFixed(4),
              changedValue: Math.round(r.qtyMaster * r.unitCostMaster),
              actorId: session.user.id,
              notes: `Belanja pasar ${r.unitCostMaster}/${r.masterUnit}`,
            });
          }
        }

        /* Movement SELALU ditulis, juga saat stoknya tidak digerakkan —
         * flag `skippedStockUpdate` yang membedakan. Laporan COGS membaca
         * baris ini untuk tahu berapa yang dibeli pada periode itu. */
        const [movement] = await tx
          .insert(inventoryMovements)
          .values({
            outletId: session.user.outletId,
            ingredientId: r.ingredientId,
            kind: "purchase",
            qtyDelta: movementDelta.bigint,
            qtyDeltaDecimal: movementDelta.decimal,
            unitCostAtMovement: r.unitCostMaster,
            referenceType: "manual",
            referenceId: row.id,
            reason: `Belanja pasar ${row.id.slice(0, 8)}${
              skipStockEffect
                ? backdated
                  ? " (backdate, stok tidak ditambah)"
                  : " (periodic, stok tidak ditambah)"
                : ""
            }`,
            skippedStockUpdate: skipStockEffect,
            createdBy: session.user.id,
          })
          .returning({ id: inventoryMovements.id });

        await tx.insert(dailyMarketItems).values({
          entryId: row.id,
          ingredientId: r.ingredientId,
          qty: r.qty.toFixed(4),
          unit: r.unit,
          qtyMaster: r.qtyMaster.toFixed(4),
          unitCost: r.unitCost,
          subtotal: r.subtotal,
          nameSnapshot: r.name,
          unitSnapshot: r.unit ?? r.masterUnit,
          sectionSnapshot: r.section,
          movementId: movement?.id ?? null,
        });
      }

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
          inventoryLines,
        }),
        status: "posted",
        actorId: session.user.id,
        receiptImageUrl: normalizeReceiptUrl(v.receiptImageUrl ?? null),
        metadata: {
          courierName: v.courierName,
          categoryId: v.categoryId,
          expenseAccountCode,
          inventoryTotal: resolved.total,
          stockApplied: !skipStockEffect,
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
        after: {
          amount: v.amount,
          expenseAccountCode,
          entryDate,
          inventoryTotal: resolved.total,
          itemCount: resolved.rows.length,
          stockApplied: !skipStockEffect,
        },
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
    /* Sesi AE-245 — baris bahannya ikut dibaca supaya sisi debit yang dibalik
     * mendarat di akun yang sama dengan waktu diposting. Tanpa ini pembalik
     * akan mengkredit beban padahal yang didebit dulu persediaan, dan kedua
     * akun itu sama-sama meleset tanpa jurnal yang tidak seimbang. */
    const itemRows = await db
      .select({
        section: dailyMarketItems.sectionSnapshot,
        subtotal: dailyMarketItems.subtotal,
      })
      .from(dailyMarketItems)
      .where(eq(dailyMarketItems.entryId, row.id));
    lines = reverseDailyMarketLines(
      mapDailyMarketSpend({
        amount: row.amount,
        expenseAccountCode,
        description: row.description,
        courierName: row.courierName ?? "kurir",
        inventoryLines: itemRows.map((i) => ({
          section: i.section as IngredientSection,
          amount: i.subtotal,
        })),
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

      /* Stok yang sempat bertambah dikembalikan. Movement yang dulu ditandai
       * `skippedStockUpdate` tidak pernah menyentuh stok, jadi tidak ada yang
       * perlu dibalik — membalikkannya justru membuat stok minus. Pola ini
       * sengaja sama persis dengan `cancelPurchase`. */
      if (row.kind === "spend") {
        const movements = await tx
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
              eq(inventoryMovements.referenceId, row.id),
              eq(inventoryMovements.kind, "purchase"),
            ),
          );

        for (const mv of movements) {
          if (mv.skippedStockUpdate) continue;
          const [ing] = await tx
            .select()
            .from(ingredients)
            .where(eq(ingredients.id, mv.ingredientId))
            .for("update")
            .limit(1);
          if (!ing) continue;

          const parsedQty = parseFloat(mv.qtyDeltaDecimal ?? "");
          const reverseQty = Number.isFinite(parsedQty) ? parsedQty : 0;
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

          const delta = formatMovementDelta(-reverseQty);
          await tx.insert(inventoryMovements).values({
            outletId: session.user.outletId,
            ingredientId: mv.ingredientId,
            kind: "adjust",
            qtyDelta: delta.bigint,
            qtyDeltaDecimal: delta.decimal,
            unitCostAtMovement: mv.unitCostAtMovement ?? 0,
            referenceType: "manual",
            referenceId: row.id,
            reason: `Batal belanja pasar ${row.id.slice(0, 8)} — ${v.reason}`,
            createdBy: session.user.id,
          });
        }
      }

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
