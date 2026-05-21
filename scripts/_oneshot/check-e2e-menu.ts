import { config } from "dotenv";
config({ path: ".env.test" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql, isNull, and, eq } from "drizzle-orm";
import { menuItems, categories } from "@/db/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const [count] = await db.select({ c: sql<number>`COUNT(*)::int` }).from(menuItems).where(and(isNull(menuItems.deletedAt), eq(menuItems.isActive, true), eq(menuItems.isSoldOut, false)));
  console.log("Menu items active not-soldout:", count.c);
  const items = await db.select({ name: menuItems.name, priceType: menuItems.priceType }).from(menuItems).where(and(isNull(menuItems.deletedAt), eq(menuItems.isActive, true), eq(menuItems.isSoldOut, false))).orderBy(menuItems.name).limit(5);
  for (const i of items) console.log(`  ${i.name} (${i.priceType})`);
  const [catCount] = await db.select({ c: sql<number>`COUNT(*)::int` }).from(categories).where(eq(categories.isActive, true));
  console.log("Categories:", catCount.c);
  process.exit(0);
}
main();
