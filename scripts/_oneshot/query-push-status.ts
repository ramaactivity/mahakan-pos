/**
 * Sesi AE-134 — Query push subscription status per user (read-only).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull, sql } from "drizzle-orm";
import { pushSubscriptions, users } from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      email: users.email,
      subCount: sql<number>`count(${pushSubscriptions.id})::int`,
      latestSub: sql<Date | null>`max(${pushSubscriptions.createdAt})`,
    })
    .from(users)
    .leftJoin(pushSubscriptions, eq(pushSubscriptions.userId, users.id))
    .where(and(isNull(users.deletedAt), eq(users.status, "active")))
    .groupBy(users.id, users.name, users.role, users.email)
    .orderBy(users.role, users.name);

  console.log("\n=== Push Notification Subscription Status ===\n");
  console.log(
    "ROLE       | NAME                | DEVICES | LAST SUB           | EMAIL",
  );
  console.log(
    "-----------|---------------------|---------|--------------------|--------------------",
  );
  for (const r of rows) {
    const role = String(r.role).padEnd(10);
    const name = r.name.padEnd(19);
    const cnt = String(r.subCount).padStart(7);
    const last = r.latestSub
      ? new Date(r.latestSub)
          .toLocaleString("id-ID", {
            timeZone: "Asia/Jakarta",
            dateStyle: "short",
            timeStyle: "short",
          })
          .padEnd(18)
      : "—".padEnd(18);
    const email = r.email ?? "—";
    console.log(`${role} | ${name} | ${cnt} | ${last} | ${email}`);
  }
  console.log("\nTotal user aktif:", rows.length);
  console.log("Sudah aktif notif:", rows.filter((r) => r.subCount > 0).length);
  console.log("Belum aktif notif:", rows.filter((r) => r.subCount === 0).length);
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
