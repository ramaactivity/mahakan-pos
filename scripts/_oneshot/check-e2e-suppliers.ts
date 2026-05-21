import { config } from "dotenv";
config({ path: ".env.test" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { desc, ilike } from "drizzle-orm";
import { suppliers } from "@/db/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const e2e = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(ilike(suppliers.name, "%E2E Supplier%")).orderBy(desc(suppliers.createdAt));
  console.log(`E2E suppliers: ${e2e.length}`);
  for (const s of e2e) console.log(`  ${s.name}`);
  process.exit(0);
}
main();
