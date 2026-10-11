import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dailyMarketEntries } from "@/db/schema";
import { recordJournal } from "@/features/accounting/posting";
import { resolveBankCodeFromBankName } from "@/features/accounting/mapping/dividendWithdrawal";
import { mapDailyMarketTopup } from "@/features/accounting/mapping/dailyMarket";
import { normalizeReceiptUrl } from "@/features/accounting/receipt-url";
import { startOfWibDateUtc } from "@/features/cash/helpers";

/**
 * Sesi AE-257 — inti pencatatan top up kurir, dipisah dari server action
 * supaya skrip migrasi memakai jalur yang SAMA dengan tombol Top Up, bukan
 * salinan aturan jurnalnya. Validasi input + izin tetap di pemanggil.
 */
export function bankLabelOf(b: {
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

/**
 * Sesi AE-258 — satu aturan untuk kolom nota: daftar URL yang lolos sanitasi,
 * dan `receiptImageUrl` = item pertama (dibaca jurnal & layar lama).
 */
export function receiptColumns(
  urls: ReadonlyArray<string | null | undefined> | null | undefined,
): { receiptImageUrl: string | null; receiptImageUrls: string[] | null } {
  const clean = (urls ?? [])
    .map((u) => normalizeReceiptUrl(u))
    .filter((u): u is string => u !== null)
    .slice(0, 5);
  return {
    receiptImageUrl: clean[0] ?? null,
    receiptImageUrls: clean.length > 0 ? clean : null,
  };
}

export async function insertDailyMarketTopup(args: {
  outletId: string;
  actorId: string;
  bank: {
    id: string;
    bankName: string;
    accountName: string;
    accountNumber: string | null;
  };
  amount: number;
  courierName: string;
  entryDate: string;
  description: string;
  receiptImageUrls: ReadonlyArray<string> | null;
}): Promise<{ id: string; journalEntryId: string }> {
  const bankLabel = bankLabelOf(args.bank);
  const { receiptImageUrl, receiptImageUrls } = receiptColumns(args.receiptImageUrls);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(dailyMarketEntries)
      .values({
        outletId: args.outletId,
        kind: "topup",
        entryDate: args.entryDate,
        occurredAt: startOfWibDateUtc(args.entryDate),
        amount: args.amount,
        description: args.description,
        courierName: args.courierName,
        bankAccountId: args.bank.id,
        receiptImageUrl,
        receiptImageUrls,
        createdBy: args.actorId,
      })
      .returning();

    const journal = await recordJournal({
      outletId: args.outletId,
      entryDate: args.entryDate,
      description: `${args.description} (${bankLabel})`,
      sourceType: "daily_market_topup",
      sourceId: row.id,
      lines: mapDailyMarketTopup({
        amount: args.amount,
        bankAccountCode: resolveBankCodeFromBankName(args.bank.bankName),
        bankLabel,
        courierName: args.courierName,
      }),
      status: "posted",
      actorId: args.actorId,
      receiptImageUrl,
      metadata: { courierName: args.courierName, bankAccountId: args.bank.id },
    });

    await tx
      .update(dailyMarketEntries)
      .set({ journalEntryId: journal.entryId })
      .where(eq(dailyMarketEntries.id, row.id));

    return { id: row.id, journalEntryId: journal.entryId };
  });
}
