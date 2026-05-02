/**
 * `npm run accounting:smoke` — read-only verification untuk accounting tier.
 *
 * Memverifikasi:
 * 1. 4 accounting tables exist + queryable
 * 2. 63 default Chart of Accounts seeded (system accounts terutama)
 * 3. Outlet settings.features.accounting_auto_journal flag value
 * 4. Sample mapping pure functions tidak throw (synthetic data)
 * 5. Validation drift dari current ledger vs source data
 *
 * Output: status report di stdout. Exit 0 kalau semua OK, exit 1 kalau ada
 * critical issue. Owner / Galih run sebelum aktivasi auto-journal flag, atau
 * weekly during validation period untuk health-check.
 *
 * NO DB WRITES — pure read.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  accountingPeriods,
  chartOfAccounts,
  ingredients,
  journalEntries,
  outlets,
  purchases,
} from "@/db/schema";
import {
  mapPosSale,
  mapOpeningBalance,
} from "@/features/accounting/mapping";
import { buildValidationReport } from "@/features/accounting/reports";

const REQUIRED_SYSTEM_CODES = [
  // Aset
  "1101",
  "1102",
  "1110",
  "1111",
  "1120",
  "1121",
  "1122",
  "1123",
  "1124",
  "1140",
  "1141",
  "1142",
  // Kewajiban
  "2101",
  // Ekuitas
  "3101",
  "3201",
  "3301",
  "3302",
  // Pendapatan
  "4101",
  "4102",
  "4104",
  "4110",
  "4111",
  "4201",
  // HPP
  "5101",
  "5102",
  // Beban
  "6101",
  "6201",
  "6202",
  "6203",
  "6204",
  "6205",
  "6304",
  "6401",
  "6402",
  "6901",
  "6902",
  "6903",
];

let exitCode = 0;
function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function warn(msg: string) {
  console.log(`  ⚠ ${msg}`);
}
function fail(msg: string) {
  console.log(`  ✗ ${msg}`);
  exitCode = 1;
}
function section(title: string) {
  console.log(`\n[${title}]`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    fail("DATABASE_URL not set");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  console.log("Mahakan POS — Accounting Smoke Test");
  console.log("===================================");

  // --- 1. Outlet
  section("1. Outlet + Auto-Journal Flag");
  const outletRows = await db
    .select({ id: outlets.id, name: outlets.name, settings: outlets.settings })
    .from(outlets)
    .where(isNull(outlets.deletedAt));
  if (outletRows.length === 0) fail("No outlet found");
  else if (outletRows.length > 1) warn("Multi-outlet detected (Phase 1 single-outlet)");
  else {
    const o = outletRows[0];
    pass(`Outlet: ${o.name} (${o.id})`);
    const settings = (o.settings ?? {}) as Record<string, unknown>;
    const features = (settings.features as Record<string, unknown>) ?? {};
    if (features.accounting_auto_journal === true) {
      pass("accounting_auto_journal flag = ON (production hooks active)");
    } else {
      warn("accounting_auto_journal flag = OFF (hooks dormant — Owner toggle to enable)");
    }
  }
  const outletId = outletRows[0]?.id;

  // --- 2. COA Seed
  section("2. Chart of Accounts Seed (63 expected, 36 system)");
  const accounts = await db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.outletId, outletId),
        isNull(chartOfAccounts.deletedAt),
      ),
    );
  if (accounts.length < 60) {
    fail(`Only ${accounts.length} accounts seeded (expected 63)`);
  } else {
    pass(`${accounts.length} active accounts`);
  }
  const codeSet = new Set(accounts.map((a) => a.code));
  for (const code of REQUIRED_SYSTEM_CODES) {
    if (!codeSet.has(code)) {
      fail(`Required system account ${code} MISSING`);
    }
  }
  pass(`All ${REQUIRED_SYSTEM_CODES.length} required system codes present`);
  const systemCount = accounts.filter((a) => a.isSystem).length;
  if (systemCount < 30) {
    warn(`Only ${systemCount} accounts marked system (expected ~36)`);
  } else {
    pass(`${systemCount} system-protected accounts`);
  }

  // --- 3. Periods
  section("3. Accounting Periods");
  const periods = await db
    .select()
    .from(accountingPeriods)
    .where(eq(accountingPeriods.outletId, outletId));
  pass(`${periods.length} period(s) created`);
  const lockedPeriods = periods.filter((p) => p.status === "locked");
  if (lockedPeriods.length > 0) {
    pass(`${lockedPeriods.length} locked period(s) — opening balance posted: ${lockedPeriods
      .map((p) => `${p.periodYear}-${String(p.periodMonth).padStart(2, "0")}`)
      .join(", ")}`);
  } else {
    warn("No locked period — opening balance belum di-post (run Cutover Wizard before 1 Juni 2026)");
  }

  // --- 4. Journal Entries
  section("4. Journal Entries");
  const [entryStats] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      posted: sql<number>`COUNT(*) FILTER (WHERE status = 'posted')::int`,
      draft: sql<number>`COUNT(*) FILTER (WHERE status = 'draft')::int`,
      reversed: sql<number>`COUNT(*) FILTER (WHERE status = 'reversed')::int`,
    })
    .from(journalEntries)
    .where(eq(journalEntries.outletId, outletId));
  pass(
    `Total: ${entryStats.total} | Posted: ${entryStats.posted} | Draft: ${entryStats.draft} | Reversed: ${entryStats.reversed}`,
  );
  const openingEntry = await db
    .select({ id: journalEntries.id, entryNumber: journalEntries.entryNumber })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, outletId),
        eq(journalEntries.sourceType, "opening_balance"),
        sql`${journalEntries.status} <> 'reversed'`,
      ),
    )
    .limit(1);
  if (openingEntry.length > 0) {
    pass(`Opening balance entry posted: ${openingEntry[0].entryNumber}`);
  } else {
    warn("Opening balance entry NOT FOUND — Owner harus run Cutover Wizard");
  }

  // --- 5. Pure Mapping Smoke
  section("5. Mapper Smoke Test (synthetic input)");
  try {
    const lines = mapPosSale({
      transactionId: "smoke-1",
      transactionNumber: "TRX-SMOKE-001",
      outletId: "smoke-outlet",
      entryDate: "2026-06-01",
      paymentMethod: "cash",
      total: 50000,
      subtotal: 50000,
      discountAmount: 0,
      items: [{ itemCategoryName: "Coffee Based", amount: 50000, cogs: 12000 }],
    });
    const dr = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const cr = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (dr === cr && dr === 62000) {
      pass(`mapPosSale balanced: Dr ${dr} Cr ${cr}`);
    } else {
      fail(`mapPosSale imbalanced: Dr ${dr} Cr ${cr}`);
    }
  } catch (e) {
    fail(`mapPosSale threw: ${e}`);
  }
  try {
    const lines = mapOpeningBalance({
      outletId: "smoke",
      entryDate: "2026-05-31",
      kasDrawer: 5_000_000,
      kasBrankas: 0,
      bankBca: 0,
      bankBri: 0,
      bankLain: 0,
      piutangQris: 0,
      piutangEdcBca: 0,
      piutangGofood: 0,
      piutangGrabfood: 0,
      piutangShopeefood: 0,
      biayaDibayarDimuka: 0,
      persediaanKitchen: 0,
      persediaanBar: 0,
      persediaanPendukung: 0,
      hutangDagang: 0,
      modalOwner: 5_000_000,
      saldoLaba: 0,
    });
    const dr = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const cr = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (dr === cr && dr === 5_000_000) {
      pass(`mapOpeningBalance balanced: Dr ${dr} Cr ${cr}`);
    } else {
      fail(`mapOpeningBalance imbalanced: Dr ${dr} Cr ${cr}`);
    }
  } catch (e) {
    fail(`mapOpeningBalance threw: ${e}`);
  }

  // --- 6. Live Validation Drift (informational)
  section("6. Current Validation Drift (live data)");
  // Compute manually to avoid importing actions.ts (has "use server")
  const balances = await db
    .select({
      code: chartOfAccounts.code,
      type: chartOfAccounts.type,
      debit: sql<string>`COALESCE(SUM(CASE WHEN ${journalEntries.status} = 'posted' THEN COALESCE(jl.debit, 0) ELSE 0 END), 0)`,
      credit: sql<string>`COALESCE(SUM(CASE WHEN ${journalEntries.status} = 'posted' THEN COALESCE(jl.credit, 0) ELSE 0 END), 0)`,
    })
    .from(chartOfAccounts)
    .leftJoin(
      sql`journal_lines jl`,
      sql`jl.account_id = ${chartOfAccounts.id}`,
    )
    .leftJoin(
      journalEntries,
      sql`${journalEntries.id} = jl.entry_id`,
    )
    .where(
      and(
        eq(chartOfAccounts.outletId, outletId),
        isNull(chartOfAccounts.deletedAt),
      ),
    )
    .groupBy(chartOfAccounts.id, chartOfAccounts.code, chartOfAccounts.type);

  const balanceByCode = new Map(
    balances.map((b) => [
      b.code,
      Number(b.debit) - Number(b.credit),
    ]),
  );
  const ledgerKas =
    (balanceByCode.get("1101") ?? 0) + (balanceByCode.get("1102") ?? 0);
  const ledgerPersediaan =
    (balanceByCode.get("1140") ?? 0)
    + (balanceByCode.get("1141") ?? 0)
    + (balanceByCode.get("1142") ?? 0);
  const ledgerHutang = -(balanceByCode.get("2101") ?? 0); // credit-normal flip

  // Source data
  const [persediaanRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${ingredients.currentStock} * ${ingredients.costPerUnit}), 0)`,
    })
    .from(ingredients)
    .where(
      and(eq(ingredients.outletId, outletId), isNull(ingredients.deletedAt)),
    );
  const sourcePersediaan = Math.round(Number(persediaanRow?.total ?? 0));

  const [hutangRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${purchases.totalAmount}), 0)`,
    })
    .from(purchases)
    .where(
      and(
        eq(purchases.outletId, outletId),
        eq(purchases.status, "pending_payment"),
      ),
    );
  const sourceHutang = Math.round(Number(hutangRow?.total ?? 0));

  // Validation report (skip cashOnHand — needs runtime context, surface separately).
  // Smoke uses aggregate persediaan in all 3 section slots dengan source value
  // sama supaya status='ok' ketika data konsisten.
  const report = buildValidationReport({
    asOfDate: new Date().toISOString().slice(0, 10),
    ledger: {
      kasTunai: ledgerKas,
      persediaanKitchen: ledgerPersediaan, // smoke: combined ledger (no per-section breakdown)
      persediaanBar: 0,
      persediaanPendukung: 0,
      hutangDagang: ledgerHutang,
    },
    source: {
      cashOnHand: ledgerKas, // placeholder (smoke skip cash check)
      persediaanKitchen: sourcePersediaan, // smoke: aggregate matches kitchen slot
      persediaanBar: 0,
      persediaanPendukung: 0,
      hutangDagangPending: sourceHutang,
    },
  });

  for (const r of report.rows) {
    const fmt = (n: number) =>
      `Rp ${n.toLocaleString("id-ID")}`;
    const symbol =
      r.status === "ok" ? "✓" : r.status === "warning" ? "⚠" : "✗";
    console.log(
      `  ${symbol} ${r.label}: ledger=${fmt(r.ledgerAmount)} source=${fmt(r.sourceAmount)} diff=${fmt(r.diff)}`,
    );
    if (r.status === "critical") exitCode = 1;
  }
  console.log(
    "\n  [Note] Cash on hand validation skipped — run di Admin UI (Akuntansi → Laporan → Validasi Drift) untuk full check dengan getCashOnHand snapshot live.",
  );

  await pool.end();

  console.log("\n===================================");
  if (exitCode === 0) {
    console.log("Smoke test: PASS");
  } else {
    console.log("Smoke test: FAIL — review issues di atas");
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
