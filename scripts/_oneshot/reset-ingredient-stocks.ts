/**
 * Sesi AE-141 — Reset semua current_stock + current_stock_decimal jadi 0
 * untuk semua active ingredient. Anisa minta supaya bisa isi ulang via
 * opname fresh.
 *
 * Plus emit 1 audit row "inventory.stock_bulk_reset" untuk traceability.
 * Tidak buat individual inventory_movements supaya tabel tidak banjir
 * (184 ingredient = 184 movements — itu noisy untuk admin movements list).
 *
 * Dry-run default. Apply: --apply.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull, sql, ne, or, inArray } from "drizzle-orm";
import { auditLogs, ingredients, users } from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(
    `\n=== Reset Ingredient Stocks (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`,
  );

  /* Find rows where current_stock != 0 OR current_stock_decimal != "0.0000". */
  const nonZero = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      currentStock: ingredients.currentStock,
      currentStockDecimal: ingredients.currentStockDecimal,
      isActive: ingredients.isActive,
    })
    .from(ingredients)
    .where(
      and(
        isNull(ingredients.deletedAt),
        or(
          ne(ingredients.currentStock, 0),
          and(
            ne(ingredients.currentStockDecimal, "0.0000"),
            ne(ingredients.currentStockDecimal, "0"),
          ),
        ),
      ),
    )
    .orderBy(ingredients.name);

  const active = nonZero.filter((r) => r.isActive);
  const inactive = nonZero.filter((r) => !r.isActive);

  console.log(`Total ingredient ber-stok > 0: ${nonZero.length}`);
  console.log(`  - Aktif:    ${active.length} (akan di-reset)`);
  console.log(`  - Inaktif:  ${inactive.length} (akan di-reset juga)`);

  if (nonZero.length === 0) {
    console.log("\nSemua stok sudah 0 — tidak perlu reset.");
    await pool.end();
    process.exit(0);
  }

  console.log("\nTop 20 yang akan di-reset (sorted by name):");
  for (const r of nonZero.slice(0, 20)) {
    const dec = r.currentStockDecimal ?? String(r.currentStock);
    const inactiveFlag = r.isActive ? "" : " (INACTIVE)";
    console.log(
      `  ${r.name.padEnd(35)} ${dec.padStart(15)} ${r.unit}${inactiveFlag}`,
    );
  }
  if (nonZero.length > 20) {
    console.log(`  ... ${nonZero.length - 20} ingredient lain`);
  }

  if (!APPLY) {
    console.log(
      `\n[DRY-RUN] Pass --apply untuk eksekusi reset ${nonZero.length} ingredient.`,
    );
    await pool.end();
    process.exit(0);
  }

  console.log("\n[APPLY] Reset semua current_stock + decimal ke 0...");

  /* Find actor user (SEED_OWNER_EMAIL atau first owner). */
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

  /* Bulk UPDATE. */
  const ids = nonZero.map((r) => r.id);
  await db
    .update(ingredients)
    .set({
      currentStock: 0,
      currentStockDecimal: "0.0000",
      updatedAt: new Date(),
      ...(actorId ? { updatedBy: actorId } : {}),
    })
    .where(inArray(ingredients.id, ids));

  /* Single audit row. entityId nullable — pass null untuk bulk op. */
  if (actorId) {
    await db.insert(auditLogs).values({
      userId: actorId,
      eventType: "inventory.stock_bulk_reset",
      entityType: "ingredient",
      entityId: null,
      payload: {
        summary: `Bulk reset ${nonZero.length} ingredient stok ke 0 (untuk fresh opname). Active: ${active.length}, Inactive: ${inactive.length}`,
        ingredientIds: ids,
        requestedBy: "Anisa via Owner request (sesi AE-141)",
      },
      metadata: {
        actorRole: "owner",
      },
    });
  }

  console.log(`✓ ${nonZero.length} ingredient ter-reset.`);
  if (!actorId) {
    console.log(
      "⚠ Tidak emit audit row karena tidak ketemu actor user (SEED_OWNER_EMAIL belum di-set + tidak ada owner default).",
    );
  }
  await pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await pool.end();
  process.exit(1);
});
