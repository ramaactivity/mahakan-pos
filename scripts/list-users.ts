import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { isNull } from "drizzle-orm";
import { users } from "@/db/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      hasPassword: users.passwordHash,
      hasPin: users.pinHash,
      createdAt: users.createdAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(isNull(users.deletedAt));

  console.log(`\n📊 ${rows.length} active user(s) in DB:\n`);
  for (const u of rows) {
    console.log(`  • ${u.name} (${u.role}) — email=${u.email ?? "—"}`);
    console.log(
      `    pwd=${u.hasPassword ? "✓" : "—"} pin=${u.hasPin ? "✓" : "—"} status=${u.status}`,
    );
    console.log(`    created ${u.createdAt.toISOString()}`);
  }
  console.log();

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
