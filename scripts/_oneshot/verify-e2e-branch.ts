/**
 * Sesi AE-85 — Verify E2E test branch reachable + data mirrored.
 *
 * Run dengan: npx tsx --env-file=.env.test scripts/_oneshot/verify-e2e-branch.ts
 *
 * Output:
 *   - DB connect OK
 *   - Investor count (expect ~73)
 *   - Outlet count (expect 1, "Mahakan Coffee & Space")
 *   - User count
 *   - Chart of accounts seeded
 */

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import {
  chartOfAccounts,
  investors,
  outlets,
  users,
} from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required (run with --env-file=.env.test)");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  console.log("== Verify E2E Branch ==");
  console.log("Connecting to:", process.env.DATABASE_URL?.replace(/:[^@]+@/, ":***@"));

  const [investorCount] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(investors);
  console.log(`Investors: ${investorCount.count}`);

  const [outletCount] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(outlets);
  console.log(`Outlets: ${outletCount.count}`);

  const outletRows = await db
    .select({ id: outlets.id, name: outlets.name })
    .from(outlets)
    .limit(5);
  for (const o of outletRows) {
    console.log(`  - ${o.name} (${o.id.slice(0, 8)})`);
  }

  const [userCount] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(users);
  console.log(`Users: ${userCount.count}`);

  const [coaCount] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(chartOfAccounts);
  console.log(`Chart of Accounts: ${coaCount.count}`);

  console.log("\n✓ Branch OK, ready untuk E2E mutation tests");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ Branch verification failed:", e.message);
  process.exit(1);
});
