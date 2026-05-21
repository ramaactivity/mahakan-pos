import { config } from "dotenv";
config({ path: ".env.test" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql, desc } from "drizzle-orm";
import { transactions } from "@/db/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const recent = await db.select({ id: transactions.id, total: transactions.total, paymentMethod: transactions.paymentMethod, status: transactions.status, transactionNumber: transactions.transactionNumber, createdAt: transactions.createdAt }).from(transactions).orderBy(desc(transactions.createdAt)).limit(5);
  console.log("Last 5 transactions:");
  for (const t of recent) console.log(`  ${t.transactionNumber} | total Rp${t.total.toLocaleString("id-ID")} | ${t.paymentMethod} | ${t.status} | ${t.createdAt.toISOString()}`);
  process.exit(0);
}
main();
