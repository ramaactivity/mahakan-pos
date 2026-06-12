/**
 * Audit AE-181 — koreksi data GL hutang (APPROVED OWNER "gas semua").
 *
 * 1. 2150: post jurnal pengakuan `creditor_create` per kreditur aktif yang
 *    belum punya jurnal (bukan hasil konversi investor) — Dr 3301 / Cr 2150
 *    sebesar outstanding. Idempotent (sourceId = creditor.id).
 * 2. 2101: pair-void 2 jurnal legacy Mei (JE-202605-0067 purchase_pay +
 *    JE-202605-0071 purchase_cancel) yang jurnal create-nya tidak pernah
 *    ada (auto-journal masih OFF saat itu) — mirror reverseJournalEntry.
 *
 * Default DRY-RUN. `--apply` untuk eksekusi.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const LEGACY_ENTRY_NUMBERS = ["JE-202605-0067", "JE-202605-0071"];
const REASON =
  "Koreksi audit AE-181: jurnal pay/cancel legacy tanpa jurnal create (auto-journal belum aktif Mei) — 2101 drift";

/* Dynamic import SETELAH dotenv config — @/db evaluasi DATABASE_URL saat
 * module load (import statis ke-hoist sebelum config jalan). */
async function loadModules() {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const { recordJournal } = await import("@/features/accounting/posting");
  const { mapCreditorCreate } = await import(
    "@/features/accounting/mapping/creditorRepayment"
  );
  const { todayWibIso } = await import("@/features/cash/helpers");
  return { db, ...schema, recordJournal, mapCreditorCreate, todayWibIso };
}
type Modules = Awaited<ReturnType<typeof loadModules>>;

async function glBalance(m: Modules, code: string): Promise<number> {
  const { db, journalLines, journalEntries, chartOfAccounts } = m;
  const [row] = await db
    .select({
      bal: sql<number>`coalesce(sum(${journalLines.credit}) - sum(${journalLines.debit}), 0)::bigint`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalLines.accountId))
    .where(
      and(eq(chartOfAccounts.code, code), eq(journalEntries.status, "posted")),
    );
  return Number(row?.bal ?? 0);
}

async function main() {
  console.log(`MODE: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);
  const m = await loadModules();
  const {
    db,
    chartOfAccounts,
    creditors,
    journalEntries,
    journalLines,
    users,
    recordJournal,
    mapCreditorCreate,
    todayWibIso,
  } = m;
  void chartOfAccounts;

  const [owner] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.role, "owner"))
    .limit(1);
  if (!owner) throw new Error("Owner user tidak ditemukan");
  console.log(`Actor: ${owner.name} (${owner.id})\n`);

  // ===== 1. Kreditur tanpa jurnal pengakuan =====
  const activeCreditors = await db
    .select()
    .from(creditors)
    .where(and(isNull(creditors.deletedAt), eq(creditors.status, "active")));

  /* Temuan dry-run: modul kreditur pernah di-WIPE + re-import → 40 row
   * sekarang semuanya baru (convertedFromInvestorAt null, id beda), sementara
   * 22 jurnal konversi lama (12jt) menunjuk id kreditur yang sudah tidak ada.
   * Pencocokan "sudah ter-jurnal" pakai NAMA + NOMINAL dari description
   * jurnal konversi, bukan sourceId. */
  const ids = activeCreditors.map((c) => c.id);
  const directCovered = await db
    .select({ sourceId: journalEntries.sourceId })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.sourceType, "creditor_create"),
        inArray(journalEntries.sourceId, ids),
        inArray(journalEntries.status, ["posted", "draft"]),
      ),
    );
  const covered = new Set(directCovered.map((e) => e.sourceId));

  const convEntries = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.sourceType, "investor_to_creditor_conversion"),
        eq(journalEntries.status, "posted"),
      ),
    );
  /* Map nama → { entryId, credit2150 } dari description 'Convert investor "X"'. */
  const convByName = new Map<string, { entryId: string; credit: number }>();
  for (const e of convEntries) {
    const nm = /Convert investor "(.+?)"/.exec(e.description ?? "")?.[1];
    if (!nm) continue;
    const ls = await db
      .select({ credit: journalLines.credit, accountId: journalLines.accountId })
      .from(journalLines)
      .where(eq(journalLines.entryId, e.id));
    const credit = ls.reduce((sum, l) => sum + Number(l.credit), 0) / 2 === 0
      ? 0
      : Math.max(...ls.map((l) => Number(l.credit)));
    convByName.set(nm.trim().toLowerCase(), { entryId: e.id, credit });
  }
  console.log(`Jurnal konversi lama (by nama): ${convByName.size}`);

  const matchedConv: Array<{ creditorId: string; name: string; entryId: string; credit: number; outstanding: number }> = [];
  const targets = activeCreditors.filter((c) => {
    if (covered.has(c.id) || c.principalOutstanding <= 0) return false;
    const conv = convByName.get(c.fullName.trim().toLowerCase());
    if (conv) {
      matchedConv.push({
        creditorId: c.id,
        name: c.fullName,
        entryId: conv.entryId,
        credit: conv.credit,
        outstanding: c.principalOutstanding,
      });
      return false; // sudah ter-credit via jurnal konversi lama
    }
    return true;
  });

  let convMismatch = false;
  for (const mr of matchedConv) {
    if (mr.credit !== mr.outstanding) {
      convMismatch = true;
      console.log(
        `  ⚠ konversi ${mr.name}: credit lama Rp ${mr.credit.toLocaleString("id-ID")} ≠ outstanding Rp ${mr.outstanding.toLocaleString("id-ID")}`,
      );
    }
  }
  console.log(`Kreditur match jurnal konversi lama: ${matchedConv.length}`);

  /* Jurnal konversi YATIM: ter-credit di GL tapi orangnya tidak ada di
   * kreditur aktif pasca wipe+re-import (mis. Muhammad Nurfaizi Agung
   * 300rb) → pair-void supaya GL = subledger truth. */
  const matchedEntryIds = new Set(matchedConv.map((mr) => mr.entryId));
  const activeNames = new Set(
    activeCreditors.map((c) => c.fullName.trim().toLowerCase()),
  );
  const orphanConv: Array<{ entryId: string; name: string; credit: number }> = [];
  for (const [nm, info] of convByName) {
    if (!matchedEntryIds.has(info.entryId) && !activeNames.has(nm)) {
      orphanConv.push({ entryId: info.entryId, name: nm, credit: info.credit });
      console.log(
        `  ⚠ ORPHAN konversi: ${nm} Rp ${info.credit.toLocaleString("id-ID")} → akan di-pair-void`,
      );
    }
  }
  const orphanTotal = orphanConv.reduce((sum, o) => sum + o.credit, 0);
  const totalAdj = targets.reduce((s, c) => s + c.principalOutstanding, 0);
  console.log(
    `Kreditur aktif: ${activeCreditors.length}; sudah ter-jurnal: ${covered.size}; TARGET: ${targets.length} (total Rp ${totalAdj.toLocaleString("id-ID")})`,
  );
  for (const c of targets) {
    console.log(
      `  + creditor_create ${c.fullName} — Cr 2150 Rp ${c.principalOutstanding.toLocaleString("id-ID")} (Dr 3301)`,
    );
  }

  const gl2150Before = await glBalance(m, "2150");
  const subledger = activeCreditors.reduce(
    (s, c) => s + c.principalOutstanding,
    0,
  );
  console.log(
    `\nGL 2150 sekarang: Rp ${gl2150Before.toLocaleString("id-ID")}; subledger: Rp ${subledger.toLocaleString("id-ID")}; gap: Rp ${(subledger - gl2150Before).toLocaleString("id-ID")}`,
  );
  /* Math akhir: GL + totalAdj (jurnal baru) − orphanTotal (void) harus
   * = subledger. */
  const totalsOk =
    totalAdj - orphanTotal === subledger - gl2150Before && !convMismatch;
  if (!totalsOk) {
    console.log(
      "⚠️  Total target ≠ gap GL atau ada mismatch konversi — ABORT bagian 2150.",
    );
  }

  if (APPLY && totalsOk) {
    /* Relink jurnal konversi orphan → creditor id baru (traceability +
     * idempotensi run berikutnya). */
    for (const mr of matchedConv) {
      await db
        .update(journalEntries)
        .set({ sourceId: mr.creditorId, updatedAt: new Date() })
        .where(eq(journalEntries.id, mr.entryId));
    }
    console.log(`  ✓ relink ${matchedConv.length} jurnal konversi → creditor id baru`);

    for (const o of orphanConv) {
      const [entry] = await db
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.id, o.entryId))
        .limit(1);
      if (!entry || entry.status !== "posted") continue;
      const ls = await db
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, entry.id));
      const counter = await recordJournal({
        outletId: entry.outletId,
        entryDate: todayWibIso(),
        description: `Reverse ${entry.entryNumber} — Koreksi audit AE-181: kreditur "${o.name}" tidak ada di data aktif pasca wipe+re-import`,
        sourceType: entry.sourceType,
        sourceId: null,
        lines: ls.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.credit),
          credit: Number(l.debit),
          description: `Reverse: ${l.description ?? ""}`,
        })),
        status: "posted",
        actorId: owner.id,
        metadata: { reversesEntryId: entry.id, via: "audit-ae181-orphan-conv" },
      });
      await db
        .update(journalEntries)
        .set({
          status: "reversed",
          reversedByEntryId: counter.entryId,
          reverseReason: "Koreksi audit AE-181: kreditur tidak ada pasca re-import",
          updatedAt: new Date(),
        })
        .where(eq(journalEntries.id, entry.id));
      await db
        .update(journalEntries)
        .set({
          reversesEntryId: entry.id,
          status: "reversed",
          updatedAt: new Date(),
        })
        .where(eq(journalEntries.id, counter.entryId));
      console.log(`  ✓ pair-void orphan konversi ${o.name}`);
    }
  }

  if (APPLY && totalsOk) {
    for (const c of targets) {
      await recordJournal({
        outletId: c.outletId,
        entryDate: String(c.startDate).slice(0, 10),
        description: `Pengakuan hutang kreditur ${c.fullName} (koreksi audit AE-181) — Rp ${c.principalOutstanding.toLocaleString("id-ID")}`,
        sourceType: "creditor_create",
        sourceId: c.id,
        lines: mapCreditorCreate({
          principal: c.principalOutstanding,
          bankAccountCode: null,
          creditorName: c.fullName,
        }),
        status: "posted",
        actorId: owner.id,
        metadata: { via: "audit-ae181-correction", creditorId: c.id },
      });
      console.log(`  ✓ posted ${c.fullName}`);
    }
  }

  // ===== 2. Pair-void 2 jurnal legacy 2101 =====
  console.log("\n===== Pair-void legacy 2101 =====");
  const legacy = await db
    .select()
    .from(journalEntries)
    .where(inArray(journalEntries.entryNumber, LEGACY_ENTRY_NUMBERS));
  for (const entry of legacy) {
    console.log(
      `${entry.entryNumber} — ${entry.sourceType} — status ${entry.status} — "${entry.description}"`,
    );
    if (entry.status !== "posted") {
      console.log("  → skip (bukan posted, mungkin sudah di-reverse)");
      continue;
    }
    const lines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, entry.id));
    for (const l of lines) {
      console.log(`    line: Dr ${l.debit} / Cr ${l.credit}`);
    }
    if (!APPLY) continue;

    /* Mirror reverseJournalEntry (accounting/actions.ts): counter entry
     * dengan lines dibalik, lalu PAIR-VOID — keduanya status 'reversed'
     * + saling link supaya keduanya excluded dari balance. */
    const counter = await recordJournal({
      outletId: entry.outletId,
      entryDate: todayWibIso(),
      description: `Reverse ${entry.entryNumber} — ${REASON}`,
      sourceType: entry.sourceType,
      sourceId: null,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        debit: Number(l.credit),
        credit: Number(l.debit),
        description: `Reverse: ${l.description ?? ""}`,
      })),
      status: "posted",
      actorId: owner.id,
      metadata: { reversesEntryId: entry.id, reason: REASON },
    });
    await db
      .update(journalEntries)
      .set({
        status: "reversed",
        reversedByEntryId: counter.entryId,
        reverseReason: REASON,
        updatedAt: new Date(),
      })
      .where(eq(journalEntries.id, entry.id));
    await db
      .update(journalEntries)
      .set({
        reversesEntryId: entry.id,
        status: "reversed",
        updatedAt: new Date(),
      })
      .where(eq(journalEntries.id, counter.entryId));
    console.log(`  ✓ pair-void → counter ${counter.entryNumber}`);
  }

  // ===== Verifikasi akhir =====
  const gl2150 = await glBalance(m, "2150");
  const gl2101 = await glBalance(m, "2101");
  console.log(
    `\nHASIL — GL 2150: Rp ${gl2150.toLocaleString("id-ID")} (subledger Rp ${subledger.toLocaleString("id-ID")}); GL 2101: Rp ${gl2101.toLocaleString("id-ID")}`,
  );
  if (!APPLY) console.log("\nDRY-RUN selesai. Jalankan ulang dengan --apply.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
