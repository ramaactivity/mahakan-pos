import "server-only";

/**
 * Pola PAIR-VOID (sesi AE-64, dipindah ke modul sendiri di AE-193).
 *
 * Membatalkan jurnal sumber dengan cara membuat entry pembalik (Dr↔Cr ditukar)
 * lalu menandai KEDUANYA `status='reversed'`. Dua-duanya keluar dari saldo
 * (semua query saldo memfilter `status='posted'`), jadi efek bersihnya nol
 * sambil jejak auditnya tetap utuh — bukan menghapus baris.
 *
 * Dipisah dari hooks.ts supaya modul jurnal harian bisa memakainya tanpa
 * membuat impor melingkar hooks ⇄ daily-sales.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, journalLines } from "@/db/schema";
import { recordJournal } from "./posting";

export type PairVoidSourceType =
  | "expense_create"
  | "income_create"
  | "purchase_create"
  | "pos_daily_sales"
  | "pos_daily_compliment";

export type PairVoidCounterType =
  | "expense_void"
  | "income_void"
  | "purchase_create_void"
  | "pos_daily_sales_void";

export async function pairVoidJournalForSource(args: {
  outletId: string;
  sourceType: PairVoidSourceType;
  voidSourceType: PairVoidCounterType;
  sourceId: string;
  actorId: string;
  reason: string;
}): Promise<void> {
  const [entry] = await db
    .select({
      id: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      entryDate: journalEntries.entryDate,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, args.outletId),
        eq(journalEntries.sourceType, args.sourceType),
        eq(journalEntries.sourceId, args.sourceId),
        eq(journalEntries.status, "posted"),
      ),
    )
    .limit(1);
  if (!entry) return; // belum pernah dijurnal — tidak ada yang dibalik

  const lines = await db
    .select({
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      description: journalLines.description,
    })
    .from(journalLines)
    .where(eq(journalLines.entryId, entry.id))
    .orderBy(asc(journalLines.lineNumber));

  const counter = await recordJournal({
    outletId: args.outletId,
    entryDate: String(entry.entryDate),
    description: `Pembatalan jurnal ${entry.entryNumber} — ${args.reason}`,
    sourceType: args.voidSourceType,
    sourceId: args.sourceId,
    lines: lines.map((l) => ({
      accountId: l.accountId,
      debit: Number(l.credit),
      credit: Number(l.debit),
      description: `Dibatalkan: ${l.description ?? ""}`,
    })),
    actorId: args.actorId,
    metadata: { reversesEntryId: entry.id, reason: args.reason },
  });

  await db.transaction(async (tx) => {
    await tx
      .update(journalEntries)
      .set({
        status: "reversed",
        reversedByEntryId: counter.entryId,
        reverseReason: args.reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(journalEntries.id, entry.id),
          eq(journalEntries.status, "posted"),
        ),
      );
    await tx
      .update(journalEntries)
      .set({
        status: "reversed",
        reversesEntryId: entry.id,
        updatedAt: new Date(),
      })
      .where(eq(journalEntries.id, counter.entryId));
  });
}
