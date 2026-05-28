/**
 * Sesi AE-152 — One-shot: sync Galih's users.pinHash → employees.attendancePinHash.
 *
 * Owner sudah reset PIN Galih ke "628321" 2x via Staff Management, tapi
 * pre-AE-152 patch sync UPDATE matched 0 rows (Galih employee belum
 * ter-link ke user). Sekarang sudah linked, tapi user.pinHash sudah ke-hash
 * bcrypt, kita tidak punya plaintext untuk re-hash ke employees.
 *
 * Strategy: copy bcrypt hash dari users.pinHash → employees.attendancePinHash.
 * Bcrypt hash identik jadi bisa verify pakai plaintext yang sama (628321).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { employees, users } from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`\n=== Sync user.pinHash → employee.attendancePinHash ===\n`);

  /* All linked employees + their user's current pinHash. */
  const rows = await db
    .select({
      empId: employees.id,
      empName: employees.fullName,
      empPinPresent: employees.attendancePinHash,
      userId: users.id,
      userName: users.name,
      userPinHash: users.pinHash,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(
      and(
        isNotNull(employees.userId),
        isNull(employees.deletedAt),
        isNotNull(users.pinHash),
        ne(users.role, "owner"),
      ),
    );

  console.log(`Linked employees dengan user.pinHash set: ${rows.length}\n`);

  let needSync = 0;
  for (const r of rows) {
    const syncNeeded = r.empPinPresent !== r.userPinHash;
    console.log(
      `  ${syncNeeded ? "→" : "✓"} ${r.userName.padEnd(20)} → emp ${r.empName} ${syncNeeded ? "(needs sync)" : "(already in sync)"}`,
    );
    if (syncNeeded) needSync++;
  }

  if (needSync === 0) {
    console.log("\nSemua sudah sync.");
    await pool.end();
    process.exit(0);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] ${needSync} akan di-sync. Pass --apply untuk eksekusi.`);
    await pool.end();
    process.exit(0);
  }

  console.log(`\n[APPLY] Syncing ${needSync} pairs...`);
  for (const r of rows) {
    if (r.empPinPresent === r.userPinHash) continue;
    await db
      .update(employees)
      .set({ attendancePinHash: r.userPinHash, updatedAt: new Date() })
      .where(eq(employees.id, r.empId));
    console.log(`  ✓ ${r.userName} → ${r.empName}`);
  }

  console.log(
    `\n✓ Done. Karyawan ter-link sekarang punya attendance PIN = POS login PIN.`,
  );
  await pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await pool.end();
  process.exit(1);
});
