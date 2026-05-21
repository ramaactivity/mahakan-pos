import { config } from "dotenv";
config({ path: ".env.test" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { isNull, eq } from "drizzle-orm";
import { shifts, users } from "@/db/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const active = await db.select().from(shifts).where(isNull(shifts.closedAt));
  console.log("Active shifts:", active.length);
  for (const s of active) {
    console.log(`  shift ${s.id.slice(0,8)} outlet=${s.outletId.slice(0,8)} userId=${s.userId.slice(0,8)} openedAt=${s.openedAt}`);
  }
  const e2eUser = await db.select().from(users).where(eq(users.email, "e2e-owner@mahakan.local"));
  console.log("E2E user:", e2eUser[0]?.id?.slice(0,8), e2eUser[0]?.role);
  process.exit(0);
}
main();
