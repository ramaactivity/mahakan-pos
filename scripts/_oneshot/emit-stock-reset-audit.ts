/**
 * Sesi AE-141 — Emit audit row untuk bulk stock reset yang sudah eksekusi
 * (reset-ingredient-stocks.ts gagal insert karena ngacu tabel yang salah,
 * tapi UPDATE-nya udah jalan). Ini emit traceability-nya.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import { auditLogs, users } from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  const actor = ownerEmail
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, ownerEmail))
        .limit(1)
    : await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "owner"))
        .limit(1);
  const actorId = actor[0]?.id ?? null;

  if (!actorId) {
    console.error("Tidak ketemu actor user (owner).");
    await pool.end();
    process.exit(1);
  }

  await db.insert(auditLogs).values({
    userId: actorId,
    eventType: "inventory.stock_bulk_reset",
    entityType: "ingredient",
    entityId: null,
    payload: {
      summary:
        "Bulk reset 138 ingredient (137 aktif + 1 inaktif) ke current_stock=0 untuk fresh opname.",
      requestedBy: "Anisa via Owner request (sesi AE-141)",
      executedAt: new Date().toISOString(),
    },
    metadata: { actorRole: "owner", source: "scripts/_oneshot/emit-stock-reset-audit.ts" },
  });

  console.log("✓ Audit row emitted untuk bulk stock reset.");
  await pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await pool.end();
  process.exit(1);
});
