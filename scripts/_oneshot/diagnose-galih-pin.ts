/**
 * Sesi AE-152 — Diagnose kenapa PIN Absensi Galih masih gagal walau owner
 * sudah reset 2x via Staff Management.
 *
 * Hypothesis: employee record Galih tidak punya userId link → sync UPDATE
 * WHERE userId = galih.user.id matched 0 rows.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { ilike, isNull, and, or, eq } from "drizzle-orm";
import { employees, users } from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  console.log("\n=== Diagnose Galih PIN ===\n");

  /* 1. Find Galih user. */
  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      pinHashPresent: users.pinHash,
    })
    .from(users)
    .where(
      or(
        ilike(users.name, "%galih%"),
        ilike(users.email, "%galih%"),
      ),
    );

  console.log(`Users matching "galih": ${userRows.length}`);
  for (const u of userRows) {
    console.log(
      `  ${u.role.padEnd(10)} ${u.name.padEnd(20)} ${u.email ?? "(no email)"} | pin: ${u.pinHashPresent ? "SET" : "null"} | id: ${u.id}`,
    );
  }

  /* 2. Find Galih employee. */
  const empRows = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      userId: employees.userId,
      status: employees.status,
      pinHashPresent: employees.attendancePinHash,
      outletId: employees.outletId,
    })
    .from(employees)
    .where(
      and(
        ilike(employees.fullName, "%galih%"),
        isNull(employees.deletedAt),
      ),
    );

  console.log(`\nEmployees matching "galih": ${empRows.length}`);
  for (const e of empRows) {
    console.log(
      `  ${e.fullName.padEnd(20)} status: ${e.status.padEnd(10)} userId: ${e.userId ?? "NULL (not linked!)"} | pin: ${e.pinHashPresent ? "SET" : "null"} | id: ${e.id}`,
    );
  }

  /* 3. Diagnosis. */
  console.log("\n=== Diagnosis ===");
  if (userRows.length === 0) {
    console.log("⚠ No user found matching 'galih'.");
  } else if (empRows.length === 0) {
    console.log("⚠ No employee found matching 'galih' — attendance kiosk won't work.");
  } else {
    for (const u of userRows) {
      const linked = empRows.find((e) => e.userId === u.id);
      const unlinked = empRows.find((e) => e.userId === null);
      if (linked) {
        console.log(
          `✓ User ${u.name} ter-link ke employee ${linked.fullName}. PIN reset sync SHOULD work.`,
        );
        console.log(
          `  → Kalau masih gagal, kemungkinan: employee status="${linked.status}" (harus "active"), atau hash bcrypt rounds beda.`,
        );
      } else if (unlinked) {
        console.log(
          `✗ User ${u.name} TIDAK ter-link ke employee. Ada employee unlinked: ${unlinked.fullName}`,
        );
        console.log(
          `  → Fix: UPDATE employees SET user_id = '${u.id}' WHERE id = '${unlinked.id}'`,
        );
        console.log(
          `  → Atau jalankan script ini dengan --link untuk auto-link.`,
        );
      } else {
        console.log(
          `✗ User ${u.name} (id: ${u.id}) tidak match employee.userId apapun.`,
        );
      }
    }
  }

  /* 4. Auto-link kalau pass --link. */
  if (process.argv.includes("--link")) {
    console.log("\n=== APPLY --link ===");
    for (const u of userRows) {
      const linked = empRows.find((e) => e.userId === u.id);
      if (linked) {
        console.log(`SKIP ${u.name} — sudah ter-link.`);
        continue;
      }
      const unlinked = empRows.find((e) => e.userId === null);
      if (!unlinked) {
        console.log(`SKIP ${u.name} — tidak ada employee unlinked yang cocok.`);
        continue;
      }
      await db
        .update(employees)
        .set({ userId: u.id, updatedAt: new Date() })
        .where(eq(employees.id, unlinked.id));
      console.log(
        `✓ Linked employee ${unlinked.fullName} → user ${u.name} (${u.id})`,
      );
    }
  }

  await pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await pool.end();
  process.exit(1);
});
