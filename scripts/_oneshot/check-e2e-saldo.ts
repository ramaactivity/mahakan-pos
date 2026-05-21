import { config } from "dotenv";
config({ path: ".env.test" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql, desc, gt, and, isNull } from "drizzle-orm";
import { investors } from "@/db/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const [total] = await db.select({ s: sql<number>`SUM(dividend_balance)::bigint` }).from(investors);
  console.log(`Σ dividend_balance: Rp ${Number(total.s ?? 0).toLocaleString("id-ID")}`);
  const top = await db.select({ name: investors.fullName, bal: investors.dividendBalance }).from(investors).where(and(gt(investors.dividendBalance, 0), isNull(investors.deletedAt))).orderBy(desc(investors.dividendBalance)).limit(10);
  console.log(`Investors dengan saldo > 0: ${top.length}`);
  for (const t of top) console.log(`  ${t.name.padEnd(35)} Rp ${t.bal.toLocaleString("id-ID")}`);
  process.exit(0);
}
main();
