import { config } from "dotenv";
config({ path: ".env.test" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql, desc } from "drizzle-orm";
import { profitDistributions } from "@/db/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const all = await db.select({ id: profitDistributions.id, year: profitDistributions.periodYear, month: profitDistributions.periodMonth, status: profitDistributions.status, model: profitDistributions.calculationModel, total: profitDistributions.bagiHasilAmount }).from(profitDistributions).orderBy(desc(profitDistributions.periodYear), desc(profitDistributions.periodMonth)).limit(10);
  console.log(`Distributions: ${all.length}`);
  for (const d of all) console.log(`  ${d.year}-${String(d.month).padStart(2,"0")} | ${d.status} | ${d.model} | bagiHasil Rp${(d.total || 0).toLocaleString("id-ID")}`);
  process.exit(0);
}
main();
