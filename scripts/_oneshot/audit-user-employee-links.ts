/**
 * Sesi AE-152 — Audit user ↔ employee linkage.
 *
 * Owner-relevant case (manager/supervisor/staff role): user yang punya akun
 * POS tapi tidak ter-link ke employee → PIN Absensi tidak ter-sync saat
 * reset di Staff Management.
 *
 * Strategy auto-link: name fuzzy match (case-insensitive, substring) DAN
 * outlet sama. Kalau ada ambiguity (multiple match) → SKIP + report manual.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { ilike, isNull, and, eq, ne } from "drizzle-orm";
import { employees, users } from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(
    `\n=== Audit User↔Employee Links (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`,
  );

  /* All non-owner users yang typically juga karyawan absensi. */
  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      outletId: users.outletId,
    })
    .from(users)
    .where(ne(users.role, "owner"));

  console.log(`Non-owner users: ${userRows.length}\n`);

  let already = 0;
  let candidate = 0;
  let ambiguous = 0;
  let nomatch = 0;
  const linkPlan: Array<{
    userId: string;
    userName: string;
    employeeId: string;
    employeeName: string;
  }> = [];

  for (const u of userRows) {
    /* Cek apakah sudah ter-link. */
    const existingLink = await db
      .select({ id: employees.id, fullName: employees.fullName })
      .from(employees)
      .where(
        and(eq(employees.userId, u.id), isNull(employees.deletedAt)),
      )
      .limit(1);

    if (existingLink.length > 0) {
      already++;
      console.log(
        `  ✓ ${u.name.padEnd(20)} (${u.role.padEnd(10)}) → ${existingLink[0].fullName}`,
      );
      continue;
    }

    /* Fuzzy match by first name segment. Match employee yang outlet sama
     * + name contains user.name (case-insensitive). */
    const firstNameToken = u.name.split(/\s+/)[0] ?? u.name;
    const matches = await db
      .select({ id: employees.id, fullName: employees.fullName })
      .from(employees)
      .where(
        and(
          ilike(employees.fullName, `%${firstNameToken}%`),
          eq(employees.outletId, u.outletId),
          isNull(employees.deletedAt),
          isNull(employees.userId),
        ),
      );

    if (matches.length === 0) {
      nomatch++;
      console.log(
        `  ✗ ${u.name.padEnd(20)} (${u.role.padEnd(10)}) → no matching employee (mungkin user tanpa absensi)`,
      );
    } else if (matches.length > 1) {
      ambiguous++;
      console.log(
        `  ? ${u.name.padEnd(20)} (${u.role.padEnd(10)}) → ${matches.length} candidates: ${matches.map((m) => m.fullName).join(", ")} (manual link needed)`,
      );
    } else {
      candidate++;
      linkPlan.push({
        userId: u.id,
        userName: u.name,
        employeeId: matches[0].id,
        employeeName: matches[0].fullName,
      });
      console.log(
        `  → ${u.name.padEnd(20)} (${u.role.padEnd(10)}) → ${matches[0].fullName} (auto-link candidate)`,
      );
    }
  }

  console.log(`\nSummary:`);
  console.log(`  ✓ Already linked:        ${already}`);
  console.log(`  → Auto-link candidate:   ${candidate}`);
  console.log(`  ? Ambiguous (manual):    ${ambiguous}`);
  console.log(`  ✗ No employee match:     ${nomatch}`);

  if (linkPlan.length === 0) {
    console.log("\nTidak ada link yang perlu di-apply.");
    await pool.end();
    process.exit(0);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] Pass --apply untuk eksekusi ${linkPlan.length} link.`);
    await pool.end();
    process.exit(0);
  }

  console.log(`\n[APPLY] Linking ${linkPlan.length} pairs...`);
  for (const p of linkPlan) {
    await db
      .update(employees)
      .set({ userId: p.userId, updatedAt: new Date() })
      .where(eq(employees.id, p.employeeId));
    console.log(`  ✓ ${p.userName} → ${p.employeeName}`);
  }

  console.log(
    `\n✓ Done. User yang sekarang ter-link akan auto-sync PIN Absensi saat owner reset PIN via Staff Management.`,
  );
  await pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await pool.end();
  process.exit(1);
});
