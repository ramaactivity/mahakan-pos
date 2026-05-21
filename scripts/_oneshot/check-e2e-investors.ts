import { config } from "dotenv";
config({ path: ".env.test" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { ilike, and, isNull } from "drizzle-orm";
import { investors } from "@/db/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const e2e = await db.select({ id: investors.id, name: investors.fullName, modal: investors.modalDisetor }).from(investors).where(and(ilike(investors.fullName, "%E2E Test%"), isNull(investors.deletedAt)));
  console.log(`Found ${e2e.length} E2E investors:`);
  for (const i of e2e) console.log(`  - ${i.name} (modal ${i.modal})`);
  process.exit(0);
}
main();
