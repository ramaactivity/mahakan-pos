/**
 * cleanup-user-test-data.ts — smart identification of test data
 * created by specific user in specific date range.
 *
 * SAFETY DESIGN:
 *   - READ-ONLY by default (no --execute mode in v1)
 *   - Identifies test entries across multiple tables
 *   - Output: terminal report + JSON file dengan IDs + actions needed
 *   - Rama reverts via UI per entry (preserves audit trail, permission
 *     checks, journal reversal side effects)
 *
 * USAGE:
 *   npx tsx scripts/cleanup-user-test-data.ts \
 *     --user pos.mahakan@gmail.com \
 *     --from 2026-05-22 \
 *     --to 2026-05-22
 *
 *   # Defaults (today WIB):
 *   npx tsx scripts/cleanup-user-test-data.ts --user pos.mahakan@gmail.com
 *
 *   # Filter specific scopes:
 *   npx tsx scripts/cleanup-user-test-data.ts \
 *     --user pos.mahakan@gmail.com \
 *     --scope purchases,deposits
 *
 *   # Custom output file:
 *   npx tsx scripts/cleanup-user-test-data.ts \
 *     --user pos.mahakan@gmail.com \
 *     --output cleanup-report.json
 *
 * SCOPES: purchases, deposits, opname, incomes, expenses, all (default)
 *
 * SECURITY GUARANTEE:
 *   Script ini PURE READ — tidak ada UPDATE, INSERT, atau DELETE.
 *   Verify dengan: `git grep -nE "update|insert|delete" scripts/cleanup-user-test-data.ts`
 *   should show only di SQL string literals (none in this file).
 */

import { config } from "dotenv";
import path from "path";
import fs from "fs";

// Load .env.local untuk DATABASE_URL prod
config({ path: path.resolve(process.cwd(), ".env.local") });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";

// ─── CLI parsing ────────────────────────────────────────────────
function parseArgs(): {
  user: string;
  from: string;
  to: string;
  scope: Set<string>;
  output: string;
} {
  const argv = process.argv.slice(2);
  let user: string | null = null;
  let from: string | null = null;
  let to: string | null = null;
  let scope = "all";
  let output = `cleanup-report-${new Date().toISOString().slice(0, 10)}.json`;

  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--user") user = argv[++i] ?? "";
    else if (k === "--from") from = argv[++i] ?? "";
    else if (k === "--to") to = argv[++i] ?? "";
    else if (k === "--scope") scope = argv[++i] ?? "all";
    else if (k === "--output") output = argv[++i] ?? output;
    else if (k === "--help" || k === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!user) {
    console.error("❌ --user <email> required.\n");
    printHelp();
    process.exit(1);
  }

  const todayWib = wibTodayIso();
  const scopeSet = scope === "all"
    ? new Set(["purchases", "deposits", "opname", "incomes", "expenses"])
    : new Set(scope.split(",").map((s) => s.trim()));

  return {
    user,
    from: from ?? todayWib,
    to: to ?? todayWib,
    scope: scopeSet,
    output,
  };
}

function printHelp() {
  console.log(`
Usage: tsx scripts/cleanup-user-test-data.ts --user <email> [options]

REQUIRED:
  --user <email>          User email yang test data perlu di-identify
                          (e.g. pos.mahakan@gmail.com)

OPTIONAL:
  --from <YYYY-MM-DD>     Start date WIB (default: today)
  --to <YYYY-MM-DD>       End date WIB inclusive (default: today)
  --scope <list>          Comma-separated: purchases, deposits, opname,
                          incomes, expenses, all (default: all)
  --output <path>         JSON report file (default: cleanup-report-<date>.json)
  -h, --help              This help

SAFETY:
  - PURE READ-ONLY. Tidak ada DB modification.
  - Output: terminal report + JSON detail.
  - Rama execute revert via UI per entry (preserves audit trail).

EXAMPLES:
  # All today's test data oleh pos.mahakan@gmail.com:
  tsx scripts/cleanup-user-test-data.ts --user pos.mahakan@gmail.com

  # Custom date range, scope spesifik:
  tsx scripts/cleanup-user-test-data.ts \\
    --user pos.mahakan@gmail.com \\
    --from 2026-05-20 --to 2026-05-22 \\
    --scope purchases,deposits
  `);
}

function wibTodayIso(): string {
  // WIB = UTC+7
  const d = new Date();
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

// ─── Color helpers (terminal) ────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function fmtRp(n: number): string {
  return "Rp " + n.toLocaleString("id-ID");
}

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().replace("T", " ").slice(0, 16);
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL not set in .env.local");
    process.exit(1);
  }

  // Detect prod vs branch
  const dbHost = new URL(DATABASE_URL).host;
  const isProd =
    !dbHost.includes("test") &&
    !dbHost.includes("e2e") &&
    !dbHost.includes("twilight-bread");

  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle({ client: pool });

  console.log("─".repeat(72));
  console.log(`${C.bold}🔍 Test Data Identification — User-Scoped${C.reset}`);
  console.log("─".repeat(72));
  console.log(`${C.dim}DB host:${C.reset}    ${dbHost} ${isProd ? `${C.red}${C.bold}[PROD]${C.reset}` : `${C.green}[branch]${C.reset}`}`);
  console.log(`${C.dim}User:${C.reset}       ${C.cyan}${args.user}${C.reset}`);
  console.log(`${C.dim}Period:${C.reset}     ${args.from} → ${args.to} (WIB)`);
  console.log(`${C.dim}Scopes:${C.reset}     ${[...args.scope].join(", ")}`);
  console.log(`${C.dim}Mode:${C.reset}       ${C.green}READ-ONLY${C.reset} (no DB modification)`);
  console.log("─".repeat(72));

  // Resolve user
  const userRes = await db.execute<{ id: string; name: string; role: string; outlet_id: string }>(
    sql`SELECT id, name, role, outlet_id FROM users WHERE email = ${args.user} LIMIT 1`,
  );
  const userRows = (userRes as unknown as { rows?: unknown[] }).rows ?? userRes;
  const userRow = Array.isArray(userRows) && userRows.length > 0 ? userRows[0] as { id: string; name: string; role: string; outlet_id: string } : null;

  if (!userRow) {
    console.error(`${C.red}❌ User '${args.user}' not found.${C.reset}`);
    await pool.end();
    process.exit(1);
  }

  console.log(`${C.green}✓${C.reset} User found: ${C.bold}${userRow.name}${C.reset} (role=${userRow.role}, id=${userRow.id.slice(0, 8)}…)`);
  console.log("");

  const userId = userRow.id;
  const fromTs = `${args.from} 00:00:00+07:00`;
  const toTs = `${args.to} 23:59:59+07:00`;

  // ─── Collectors ──────────────────────────────────────────────
  type Finding = {
    entity: string;
    id: string;
    label: string;
    createdAt: string;
    amount?: number;
    status?: string;
    extra?: Record<string, unknown>;
    actionGuide: string;
  };
  const findings: Record<string, Finding[]> = {};

  // ─── Purchases ───────────────────────────────────────────────
  if (args.scope.has("purchases")) {
    const rows = await db.execute(sql`
      SELECT
        p.id, p.invoice_no, p.created_at, p.total_amount AS amount, p.status,
        p.payment_method, p.purchase_date, p.notes,
        s.name AS supplier_name
      FROM purchases p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.created_by = ${userId}
        AND p.created_at >= ${fromTs}
        AND p.created_at <= ${toTs}
      ORDER BY p.created_at DESC
    `);
    const arr = ((rows as unknown as { rows?: unknown[] }).rows ?? []) as Array<{
      id: string; invoice_no: string | null; created_at: string; amount: string;
      status: string; payment_method: string; purchase_date: string;
      notes: string | null; supplier_name: string | null;
    }>;
    findings.purchases = arr.map((r) => ({
      entity: "purchase",
      id: r.id,
      label: `${r.supplier_name ?? "(walk-in)"} — ${r.invoice_no ?? r.purchase_date}`,
      createdAt: r.created_at,
      amount: Number(r.amount),
      status: r.status,
      extra: {
        payment_method: r.payment_method,
        purchase_date: r.purchase_date,
        notes: r.notes,
      },
      actionGuide: r.status === "cancelled"
        ? "ALREADY cancelled — skip"
        : "UI: Admin → Inventory → tab Pembelian → klik baris → Cancel (reverse stock + journal)",
    }));
  }

  // ─── Cash Deposits ───────────────────────────────────────────
  if (args.scope.has("deposits")) {
    const rows = await db.execute(sql`
      SELECT
        cd.id, cd.deposit_date, cd.amount, cd.bank_destination, cd.status,
        cd.created_at, cd.covers_from_date, cd.covers_to_date, cd.notes
      FROM cash_deposits cd
      WHERE cd.deposited_by = ${userId}
        AND cd.created_at >= ${fromTs}
        AND cd.created_at <= ${toTs}
      ORDER BY cd.created_at DESC
    `);
    const arr = ((rows as unknown as { rows?: unknown[] }).rows ?? []) as Array<{
      id: string; deposit_date: string; amount: string; bank_destination: string; status: string;
      created_at: string; covers_from_date: string; covers_to_date: string; notes: string;
    }>;
    findings.deposits = arr.map((r) => ({
      entity: "cash_deposit",
      id: r.id,
      label: `Setoran ke ${r.bank_destination}`,
      createdAt: r.created_at,
      amount: Number(r.amount),
      status: r.status,
      extra: { covers: `${r.covers_from_date}…${r.covers_to_date}`, notes: r.notes },
      actionGuide:
        r.status === "verified"
          ? "UI: Admin → Cashflow → Setoran Tunai → klik baris → Revert ke Pending (reverse journal)"
          : r.status === "pending_verification"
            ? "INFO ONLY: status=pending → no journal posted yet, no action needed (atau biarkan kalau owner verify nanti tolak)"
            : "ALREADY rejected — skip",
    }));
  }

  // ─── Opname Sessions ─────────────────────────────────────────
  if (args.scope.has("opname")) {
    const rows = await db.execute(sql`
      SELECT
        s.id, s.period_label, s.status, s.started_at, s.finalized_at,
        s.notes, s.counted_lines, s.total_lines
      FROM stock_opname_sessions s
      WHERE s.started_by = ${userId}
        AND s.started_at >= ${fromTs}
        AND s.started_at <= ${toTs}
      ORDER BY s.started_at DESC
    `);
    const arr = ((rows as unknown as { rows?: unknown[] }).rows ?? []) as Array<{
      id: string; period_label: string; status: string; started_at: string;
      finalized_at: string | null; notes: string;
      counted_lines: number; total_lines: number;
    }>;
    findings.opname = arr.map((r) => ({
      entity: "opname_session",
      id: r.id,
      label: `Opname ${r.period_label} (${r.counted_lines}/${r.total_lines} lines)`,
      createdAt: r.started_at,
      status: r.status,
      extra: { finalized_at: r.finalized_at, notes: r.notes },
      actionGuide:
        r.status === "in_progress" || r.status === "pending_review"
          ? "UI: Admin → Inventory → tab Opname → buka session → Cancel (snapshot tetap untuk audit)"
          : r.status === "completed"
            ? "ALREADY completed — stock sudah ke-adjust. Reverse: bikin opname BARU dengan count benar"
            : "ALREADY cancelled — skip",
    }));
  }

  // ─── Incomes ─────────────────────────────────────────────────
  if (args.scope.has("incomes")) {
    const rows = await db.execute(sql`
      SELECT
        i.id, i.amount, i.description, i.payment_method, i.income_date,
        i.created_at, i.deleted_at
      FROM incomes i
      WHERE i.created_by = ${userId}
        AND i.created_at >= ${fromTs}
        AND i.created_at <= ${toTs}
      ORDER BY i.created_at DESC
    `);
    const arr = ((rows as unknown as { rows?: unknown[] }).rows ?? []) as Array<{
      id: string; amount: string; description: string; payment_method: string;
      income_date: string; created_at: string; deleted_at: string | null;
    }>;
    findings.incomes = arr.map((r) => ({
      entity: "income",
      id: r.id,
      label: `Pemasukan ${r.payment_method}: ${r.description}`,
      createdAt: r.created_at,
      amount: Number(r.amount),
      status: r.deleted_at ? "deleted" : "active",
      extra: { income_date: r.income_date },
      actionGuide: r.deleted_at
        ? "ALREADY deleted — skip"
        : "UI: Admin → Cashflow → Kas → tab Pemasukan → klik baris → Hapus (reverse journal)",
    }));
  }

  // ─── Expenses ────────────────────────────────────────────────
  if (args.scope.has("expenses")) {
    const rows = await db.execute(sql`
      SELECT
        e.id, e.amount, e.description, e.payment_method, e.expense_date,
        e.created_at, e.deleted_at, e.source_type
      FROM expenses e
      WHERE e.created_by = ${userId}
        AND e.created_at >= ${fromTs}
        AND e.created_at <= ${toTs}
      ORDER BY e.created_at DESC
    `);
    const arr = ((rows as unknown as { rows?: unknown[] }).rows ?? []) as Array<{
      id: string; amount: string; description: string; payment_method: string;
      expense_date: string; created_at: string; deleted_at: string | null; source_type: string;
    }>;
    findings.expenses = arr.map((r) => ({
      entity: "expense",
      id: r.id,
      label: `Pengeluaran ${r.payment_method}: ${r.description}`,
      createdAt: r.created_at,
      amount: Number(r.amount),
      status: r.deleted_at ? "deleted" : `active (${r.source_type})`,
      extra: { expense_date: r.expense_date },
      actionGuide: r.deleted_at
        ? "ALREADY deleted — skip"
        : r.source_type === "refund"
          ? "AUTO-CREATED by refund — DON'T DELETE DIRECT. Revert POS refund via UI Riwayat → expense akan auto-reverse."
          : r.source_type === "purchase"
            ? "AUTO-CREATED by purchase — DON'T DELETE DIRECT. Cancel purchase di tab Pembelian → expense akan auto-reverse."
            : r.source_type === "payroll"
              ? "AUTO-CREATED by payroll — DON'T DELETE DIRECT. Cancel/unpost payroll line → expense akan auto-reverse."
              : "UI: Admin → Cashflow → Kas → tab Pengeluaran → klik baris → Hapus (reverse journal)",
    }));
  }

  // ─── Render report ──────────────────────────────────────────
  let totalActive = 0;
  let totalSkip = 0;
  for (const [scopeKey, items] of Object.entries(findings)) {
    if (items.length === 0) {
      console.log(`${C.dim}━━━━ ${scopeKey.toUpperCase()} (0) ━━━━${C.reset}`);
      console.log(`  ${C.dim}None.${C.reset}\n`);
      continue;
    }
    const activeCount = items.filter((f) => !f.actionGuide.startsWith("ALREADY") && !f.actionGuide.startsWith("INFO")).length;
    const skipCount = items.length - activeCount;
    totalActive += activeCount;
    totalSkip += skipCount;

    console.log(`${C.bold}${C.yellow}━━━━ ${scopeKey.toUpperCase()} (${items.length} entries: ${activeCount} need action, ${skipCount} skip)${C.reset}\n`);

    for (const [idx, f] of items.entries()) {
      const needsAction = !f.actionGuide.startsWith("ALREADY") && !f.actionGuide.startsWith("INFO");
      const marker = needsAction ? `${C.yellow}●${C.reset}` : `${C.dim}○${C.reset}`;
      console.log(`  ${marker} [${idx + 1}] ${C.bold}${f.label}${C.reset}`);
      console.log(`    ${C.dim}id:${C.reset}     ${f.id}`);
      console.log(`    ${C.dim}status:${C.reset} ${f.status ?? "—"}${f.amount !== undefined ? `   ${C.dim}amount:${C.reset} ${fmtRp(f.amount)}` : ""}`);
      console.log(`    ${C.dim}when:${C.reset}   ${fmtDate(f.createdAt)}`);
      console.log(`    ${needsAction ? C.cyan : C.dim}action:${C.reset} ${f.actionGuide}`);
      console.log("");
    }
  }

  console.log("─".repeat(72));
  console.log(`${C.bold}Summary${C.reset}`);
  console.log(`  Active (need action): ${C.yellow}${totalActive}${C.reset}`);
  console.log(`  Skip (already done):  ${C.dim}${totalSkip}${C.reset}`);
  console.log(`  ${C.green}Output JSON:${C.reset} ${args.output}`);
  console.log("─".repeat(72));

  // ─── Write JSON report ──────────────────────────────────────
  const report = {
    generatedAt: new Date().toISOString(),
    user: {
      email: args.user,
      id: userRow.id,
      name: userRow.name,
      role: userRow.role,
    },
    period: { from: args.from, to: args.to },
    db: { host: dbHost, isProd },
    scopes: [...args.scope],
    summary: { active: totalActive, skip: totalSkip, total: totalActive + totalSkip },
    findings,
  };
  fs.writeFileSync(args.output, JSON.stringify(report, null, 2));

  await pool.end();

  if (totalActive > 0) {
    console.log("");
    console.log(`${C.yellow}⚠️  Action required:${C.reset} buka UI lalu revert/cancel per entry sesuai actionGuide.`);
    console.log(`    JSON detail: ${args.output}`);
  } else {
    console.log("");
    console.log(`${C.green}✓ No active test data to clean up.${C.reset}`);
  }
}

main().catch((err) => {
  console.error("❌ Script failed:", err);
  process.exit(1);
});
