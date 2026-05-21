/**
 * Sesi AE-76 — one-shot diagnostic untuk inspect entry_number sequence
 * di period yang bermasalah. Cek gap / duplicate / max value.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, asc, eq } from "drizzle-orm";
import { accountingPeriods, journalEntries } from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const PERIOD_ID =
  process.argv[2] ?? "ff084a7e-bec9-46c1-8810-8d7bac60c2ec"; // dari error

async function main() {
  const [period] = await db
    .select()
    .from(accountingPeriods)
    .where(eq(accountingPeriods.id, PERIOD_ID))
    .limit(1);
  console.log("Period:", period);

  const rows = await db
    .select({
      id: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      sourceType: journalEntries.sourceType,
      sourceId: journalEntries.sourceId,
      status: journalEntries.status,
      entryDate: journalEntries.entryDate,
      createdAt: journalEntries.createdAt,
    })
    .from(journalEntries)
    .where(eq(journalEntries.periodId, PERIOD_ID))
    .orderBy(asc(journalEntries.entryNumber));

  console.log(`\nTotal entries di period: ${rows.length}`);
  console.log(`Count(*) yang dipakai recordJournal: ${rows.length}`);
  console.log(`Next seq akan jadi: ${rows.length + 1}`);

  // Parse seq dari entry_number
  const seqRegex = /-(\d+)$/;
  const seqs: number[] = [];
  for (const r of rows) {
    const m = r.entryNumber.match(seqRegex);
    if (m) seqs.push(Number(m[1]));
  }
  const maxSeq = Math.max(...seqs);
  const minSeq = Math.min(...seqs);
  console.log(`Min entry_number seq: ${minSeq}`);
  console.log(`Max entry_number seq: ${maxSeq}`);
  console.log(`Expected count = max seq? ${rows.length === maxSeq ? "YES (no gap)" : "NO (gap detected)"}`);

  // Find gaps
  const seqSet = new Set(seqs);
  const gaps: number[] = [];
  for (let i = 1; i <= maxSeq; i++) {
    if (!seqSet.has(i)) gaps.push(i);
  }
  if (gaps.length > 0) {
    console.log(`\nGaps (missing seqs): ${gaps.join(", ")}`);
  }

  // Find duplicates
  const seqCount = new Map<number, number>();
  for (const s of seqs) seqCount.set(s, (seqCount.get(s) ?? 0) + 1);
  const dupes = Array.from(seqCount.entries()).filter(([, c]) => c > 1);
  if (dupes.length > 0) {
    console.log(`\n⚠ Duplicate seqs:`, dupes);
  }

  // Print first 5 and last 10 entries
  console.log("\n--- First 5 entries ---");
  for (const r of rows.slice(0, 5)) {
    console.log(
      `${r.entryNumber} | ${r.sourceType} | ${r.status} | ${r.entryDate} | created ${r.createdAt.toISOString()}`,
    );
  }
  console.log("\n--- Last 15 entries ---");
  for (const r of rows.slice(-15)) {
    console.log(
      `${r.entryNumber} | ${r.sourceType} | ${r.status} | ${r.entryDate} | created ${r.createdAt.toISOString()}`,
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
