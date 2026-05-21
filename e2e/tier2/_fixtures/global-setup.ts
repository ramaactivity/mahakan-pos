/**
 * Sesi AE-85 — Playwright global setup untuk Tier 2 mutation tests.
 *
 * Idempotent: creates test user `e2e-owner@mahakan.local` dengan PIN
 * '000000' di outlet pertama kalau belum ada. Test specs pakai user ini
 * untuk PIN-based login.
 *
 * SAFE karena:
 *   - Test branch DB only (DATABASE_URL pointing ke Neon branch)
 *   - User existing dari prod TIDAK di-mutate
 *   - Cleanup: branch auto-delete dalam 24h via Neon auto-delete setting
 *
 * Run automatic oleh Playwright sebelum spec pertama dijalankan (see
 * playwright.config.ts globalSetup field).
 */

import { config } from "dotenv";
config({ path: ".env.test" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { outlets, users } from "@/db/schema";

const E2E_USER_EMAIL = "e2e-owner@mahakan.local";
const E2E_USER_NAME = "E2E Test Owner";
const E2E_USER_PIN = "000000";

async function globalSetup() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      ".env.test tidak ada / DATABASE_URL kosong. Setup branch dulu (lihat e2e/tier2/_README.md).",
    );
  }
  /* Safety guard — jangan biarin global setup nyentuh prod DB. */
  if (
    !process.env.DATABASE_URL.includes("e2e") &&
    !process.env.DATABASE_URL.includes("test") &&
    !process.env.DATABASE_URL.includes("twilight-bread") // sesi AE-85 branch hostname
  ) {
    throw new Error(
      `Refusing to run E2E setup against non-test DB. Make sure DATABASE_URL points to test branch (current: ${process.env.DATABASE_URL.replace(/:[^@]+@/, ":***@")})`,
    );
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const [outlet] = await db.select().from(outlets).limit(1);
  if (!outlet) {
    throw new Error(
      "Test branch tidak punya outlet — branch corrupt? Re-create dari prod.",
    );
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.email, E2E_USER_EMAIL),
        eq(users.outletId, outlet.id),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  if (existing) {
    console.log(`[e2e setup] user '${E2E_USER_EMAIL}' sudah ada`);
    await pool.end();
    return;
  }

  const pinHash = await bcrypt.hash(E2E_USER_PIN, 8);
  const passwordHash = await bcrypt.hash("e2e-test-password", 8);
  const [created] = await db
    .insert(users)
    .values({
      name: E2E_USER_NAME,
      email: E2E_USER_EMAIL,
      role: "owner",
      outletId: outlet.id,
      status: "active",
      pinHash,
      passwordHash,
    })
    .returning({ id: users.id });

  console.log(
    `[e2e setup] created test user ${E2E_USER_EMAIL} (id ${created.id.slice(0, 8)}) di outlet ${outlet.name}`,
  );

  await pool.end();
}

export default globalSetup;
