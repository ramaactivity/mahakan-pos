import "server-only";

/**
 * Sesi AE-193 — posting jurnal penjualan HARIAN.
 *
 * Satu hari kalender WIB → satu entry `pos_daily_sales` (+ satu
 * `pos_daily_compliment` kalau ada transaksi gratisan). Menggantikan satu
 * entry per transaksi sejak tanggal cutover `dailyJournalSince`.
 *
 * Sifat penting:
 *  - IDEMPOTEN. Aman dipanggil berkali-kali; kalau isinya tidak berubah,
 *    tidak ada tulisan ke DB sama sekali.
 *  - HITUNG ULANG OTOMATIS. Kalau transaksi hari itu berubah setelah jurnal
 *    dibuat (void / koreksi), batch-nya dibalik lalu diposting ulang dengan
 *    pola pair-void yang sudah dipakai expense/income.
 *  - MENUNDA selama masih ada shift terbuka yang menyentuh tanggal itu, supaya
 *    satu hari tidak dibalik-posting berkali-kali dalam sehari.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, posDailyJournals } from "@/db/schema";
import { recordJournal } from "./posting";
import { getDailyJournalSince, isAutoJournalEnabled } from "./flag";
import { pairVoidJournalForSource } from "./journal-void";
import { mapPosSale } from "./mapping/posSale";
import { mapPosCompliment } from "./mapping/posCompliment";
import {
  describeDailyCompliment,
  describeDailySales,
  isDailyJournalDate,
  toDailyComplimentInput,
  toDailySaleInput,
  totalCogsOf,
  type DailyComplimentAggregate,
  type DailySalesAggregate,
} from "./daily-sales-pure";
import {
  fetchDailyComplimentAggregate,
  fetchDailySalesAggregate,
  hasOpenShiftOnDate,
} from "./daily-sales-queries";

export type DailyPostOutcome =
  | "posted"
  | "recomputed"
  | "unchanged"
  | "empty"
  | "deferred_open_shift"
  | "disabled";

export interface PostDailyArgs {
  outletId: string;
  /** YYYY-MM-DD kalender WIB. */
  entryDate: string;
  actorId: string;
  /** Abaikan penundaan "shift masih terbuka" (dipakai penutupan shift). */
  force?: boolean;
}

/**
 * Posting/ hitung-ulang jurnal harian untuk satu tanggal.
 *
 * Mengembalikan hasilnya (bukan melempar) supaya pemanggil — penutupan shift
 * dan sapuan berkala — bisa melaporkan apa yang terjadi tanpa menggagalkan
 * alur bisnisnya.
 */
export async function postJournalForPosDailySales(
  args: PostDailyArgs,
): Promise<DailyPostOutcome> {
  if (!(await isAutoJournalEnabled(args.outletId))) return "disabled";

  const since = await getDailyJournalSince(args.outletId);
  if (!isDailyJournalDate(args.entryDate, since)) return "disabled";

  if (!args.force && (await hasOpenShiftOnDate(args.outletId, args.entryDate))) {
    return "deferred_open_shift";
  }

  const salesOutcome = await syncSalesBatch(args);
  const complimentOutcome = await syncComplimentBatch(args);

  /* Ringkas dua batch jadi satu hasil: apa pun yang paling "berat" yang
   * menang, supaya pemanggil tahu ada tulisan terjadi. */
  const rank: Record<DailyPostOutcome, number> = {
    disabled: 0,
    deferred_open_shift: 1,
    empty: 2,
    unchanged: 3,
    posted: 4,
    recomputed: 5,
  };
  return rank[salesOutcome] >= rank[complimentOutcome]
    ? salesOutcome
    : complimentOutcome;
}

async function syncSalesBatch(args: PostDailyArgs): Promise<DailyPostOutcome> {
  const agg = await fetchDailySalesAggregate(args.outletId, args.entryDate);
  const snapshot = {
    transactionCount: agg.transactionCount,
    grossTotal: agg.total,
    discountTotal: agg.discountAmount,
    cogsTotal: totalCogsOf(agg.categories),
  };

  const batch = await upsertBatch(args.outletId, args.entryDate, "sales", snapshot);

  if (agg.transactionCount === 0) {
    /* Hari tanpa penjualan. Kalau sebelumnya sempat ada jurnal (misal semua
     * transaksinya di-void belakangan), jurnalnya wajib dibalik. */
    const reverted = await voidIfPosted(
      args,
      batch.id,
      "pos_daily_sales",
      "Semua transaksi hari itu dibatalkan",
    );
    await markBatch(batch.id, "skipped", snapshot, reverted);
    return reverted ? "recomputed" : "empty";
  }

  const existing = await findActiveEntry(args.outletId, "pos_daily_sales", batch.id);
  if (existing && !snapshotChanged(batch, snapshot)) return "unchanged";

  const recomputed = Boolean(existing);
  if (existing) {
    await pairVoidJournalForSource({
      outletId: args.outletId,
      sourceType: "pos_daily_sales",
      voidSourceType: "pos_daily_sales_void",
      sourceId: batch.id,
      actorId: args.actorId,
      reason: "Transaksi hari itu berubah — jurnal harian diposting ulang",
    });
  }

  await postSales(args, batch.id, agg);
  await markBatch(batch.id, "posted", snapshot, recomputed);
  return recomputed ? "recomputed" : "posted";
}

async function syncComplimentBatch(
  args: PostDailyArgs,
): Promise<DailyPostOutcome> {
  const agg = await fetchDailyComplimentAggregate(
    args.outletId,
    args.entryDate,
  );
  const cogsTotal = totalCogsOf(agg.categories);
  const snapshot = {
    transactionCount: agg.transactionCount,
    grossTotal: 0,
    discountTotal: 0,
    cogsTotal,
  };

  const batch = await upsertBatch(
    args.outletId,
    args.entryDate,
    "compliment",
    snapshot,
  );

  /* HPP nol = tidak ada resep terpasang. Sama dengan jalur per-transaksi:
   * jangan posting entry kosong, cukup dicatat sebagai skipped. */
  if (agg.transactionCount === 0 || cogsTotal === 0) {
    const reverted = await voidIfPosted(
      args,
      batch.id,
      "pos_daily_compliment",
      "Compliment hari itu tidak lagi punya HPP",
    );
    await markBatch(batch.id, "skipped", snapshot, reverted);
    return reverted ? "recomputed" : "empty";
  }

  const existing = await findActiveEntry(
    args.outletId,
    "pos_daily_compliment",
    batch.id,
  );
  if (existing && !snapshotChanged(batch, snapshot)) return "unchanged";

  const recomputed = Boolean(existing);
  if (existing) {
    await pairVoidJournalForSource({
      outletId: args.outletId,
      sourceType: "pos_daily_compliment",
      voidSourceType: "pos_daily_sales_void",
      sourceId: batch.id,
      actorId: args.actorId,
      reason: "Compliment hari itu berubah — jurnal harian diposting ulang",
    });
  }

  await postCompliment(args, batch.id, agg);
  await markBatch(batch.id, "posted", snapshot, recomputed);
  return recomputed ? "recomputed" : "posted";
}

async function postSales(
  args: PostDailyArgs,
  batchId: string,
  agg: DailySalesAggregate,
): Promise<void> {
  const lines = mapPosSale(toDailySaleInput(agg, batchId));
  await recordJournal({
    outletId: args.outletId,
    entryDate: agg.entryDate,
    description: describeDailySales(agg),
    sourceType: "pos_daily_sales",
    sourceId: batchId,
    lines,
    actorId: args.actorId,
    metadata: {
      transactionCount: agg.transactionCount,
      total: agg.total,
      payments: agg.payments,
    },
  });
}

async function postCompliment(
  args: PostDailyArgs,
  batchId: string,
  agg: DailyComplimentAggregate,
): Promise<void> {
  const lines = mapPosCompliment(toDailyComplimentInput(agg, batchId));
  if (lines.length === 0) return;
  await recordJournal({
    outletId: args.outletId,
    entryDate: agg.entryDate,
    description: describeDailyCompliment(agg),
    sourceType: "pos_daily_compliment",
    sourceId: batchId,
    lines,
    actorId: args.actorId,
    metadata: { transactionCount: agg.transactionCount },
  });
}

// ---------------------------------------------------------------- batch row

type Snapshot = {
  transactionCount: number;
  grossTotal: number;
  discountTotal: number;
  cogsTotal: number;
};

type BatchRow = {
  id: string;
  status: "posted" | "stale" | "skipped";
  transactionCount: number;
  grossTotal: number;
  discountTotal: number;
  cogsTotal: number;
};

async function upsertBatch(
  outletId: string,
  entryDate: string,
  kind: "sales" | "compliment",
  snapshot: Snapshot,
): Promise<BatchRow> {
  const [existing] = await db
    .select({
      id: posDailyJournals.id,
      status: posDailyJournals.status,
      transactionCount: posDailyJournals.transactionCount,
      grossTotal: posDailyJournals.grossTotal,
      discountTotal: posDailyJournals.discountTotal,
      cogsTotal: posDailyJournals.cogsTotal,
    })
    .from(posDailyJournals)
    .where(
      and(
        eq(posDailyJournals.outletId, outletId),
        eq(posDailyJournals.entryDate, entryDate),
        eq(posDailyJournals.kind, kind),
      ),
    )
    .limit(1);
  if (existing) return existing as BatchRow;

  /* onConflictDoNothing + baca ulang: dua penutupan shift bersamaan pada
   * tanggal yang sama tidak boleh membuat dua batch (unique index sudah
   * menjaga, ini supaya tidak melempar). */
  await db
    .insert(posDailyJournals)
    .values({
      outletId,
      entryDate,
      kind,
      status: "stale",
      transactionCount: snapshot.transactionCount,
      grossTotal: snapshot.grossTotal,
      discountTotal: snapshot.discountTotal,
      cogsTotal: snapshot.cogsTotal,
    })
    .onConflictDoNothing();

  const [row] = await db
    .select({
      id: posDailyJournals.id,
      status: posDailyJournals.status,
      transactionCount: posDailyJournals.transactionCount,
      grossTotal: posDailyJournals.grossTotal,
      discountTotal: posDailyJournals.discountTotal,
      cogsTotal: posDailyJournals.cogsTotal,
    })
    .from(posDailyJournals)
    .where(
      and(
        eq(posDailyJournals.outletId, outletId),
        eq(posDailyJournals.entryDate, entryDate),
        eq(posDailyJournals.kind, kind),
      ),
    )
    .limit(1);
  if (!row) throw new Error("DAILY_BATCH_UPSERT_FAILED");
  return row as BatchRow;
}

function snapshotChanged(batch: BatchRow, snapshot: Snapshot): boolean {
  return (
    batch.status !== "posted" ||
    batch.transactionCount !== snapshot.transactionCount ||
    Number(batch.grossTotal) !== snapshot.grossTotal ||
    Number(batch.discountTotal) !== snapshot.discountTotal ||
    Number(batch.cogsTotal) !== snapshot.cogsTotal
  );
}

async function markBatch(
  batchId: string,
  status: "posted" | "stale" | "skipped",
  snapshot: Snapshot,
  recomputed: boolean,
): Promise<void> {
  await db
    .update(posDailyJournals)
    .set({
      status,
      transactionCount: snapshot.transactionCount,
      grossTotal: snapshot.grossTotal,
      discountTotal: snapshot.discountTotal,
      cogsTotal: snapshot.cogsTotal,
      computedAt: new Date(),
      ...(recomputed
        ? {
            recomputeCount: sql`${posDailyJournals.recomputeCount} + 1`,
          }
        : {}),
    })
    .where(eq(posDailyJournals.id, batchId));
}

async function findActiveEntry(
  outletId: string,
  sourceType: "pos_daily_sales" | "pos_daily_compliment",
  sourceId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, outletId),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
        eq(journalEntries.status, "posted"),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function voidIfPosted(
  args: PostDailyArgs,
  batchId: string,
  sourceType: "pos_daily_sales" | "pos_daily_compliment",
  reason: string,
): Promise<boolean> {
  const existing = await findActiveEntry(args.outletId, sourceType, batchId);
  if (!existing) return false;
  await pairVoidJournalForSource({
    outletId: args.outletId,
    sourceType,
    voidSourceType: "pos_daily_sales_void",
    sourceId: batchId,
    actorId: args.actorId,
    reason,
  });
  return true;
}
