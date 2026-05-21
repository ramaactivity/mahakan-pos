import { config } from "dotenv";
config({ path: ".env.test" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { desc, eq, sql } from "drizzle-orm";
import { transactions } from "@/db/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const open = await db.select().from(transactions).where(eq(transactions.status, "open")).orderBy(desc(transactions.createdAt)).limit(5);
  console.log(`Open bills: ${open.length}`);
  for (const t of open) console.log(`  ${t.transactionNumber} | ${t.customerName ?? "(no name)"} | Rp${t.total.toLocaleString("id-ID")}`);
  const recent = await db.select({ tn: transactions.transactionNumber, st: transactions.status, cn: transactions.customerName, t: transactions.total, ca: transactions.createdAt }).from(transactions).orderBy(desc(transactions.createdAt)).limit(5);
  console.log("Last 5 transactions:");
  for (const t of recent) console.log(`  ${t.tn} | ${t.st} | ${t.cn ?? "—"} | Rp${t.t.toLocaleString("id-ID")} | ${t.ca.toISOString()}`);
  process.exit(0);
}
main();
