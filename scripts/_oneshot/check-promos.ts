import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { promos, promoUsages, transactions, outlets } from "@/db/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const db = drizzle(pool);

  const [outlet] = await db
    .select()
    .from(outlets)
    .where(isNull(outlets.deletedAt))
    .limit(1);
  console.log("outlet:", outlet.id, outlet.name);

  // Mirror the new fetchPromos logic exactly.
  const conds = [eq(promos.outletId, outlet.id), isNull(promos.deletedAt)];
  const rows = await db
    .select()
    .from(promos)
    .where(and(...conds))
    .orderBy(desc(promos.createdAt));

  console.log(`Step 1 — promos: ${rows.length} rows`);

  if (rows.length > 0) {
    const promoIds = rows.map((r) => r.id);
    const aggRows = await db
      .select({
        promoId: promoUsages.promoId,
        totalDiscountGiven: sql<string>`COALESCE(SUM(${promoUsages.discountAmount}), 0)::text`,
      })
      .from(promoUsages)
      .innerJoin(transactions, eq(transactions.id, promoUsages.transactionId))
      .where(
        and(
          inArray(promoUsages.promoId, promoIds),
          sql`${transactions.status} NOT IN ('voided', 'refunded')`,
        ),
      )
      .groupBy(promoUsages.promoId);
    console.log(`Step 2 — usage aggregates: ${aggRows.length} rows`);
  }

  console.log("✅ Both queries OK");
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
