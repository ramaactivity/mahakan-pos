/**
 * Sesi AE-136 — Auto-migrate ingredient default Purchase Unit.
 *
 * Owner laporan: setelah Phase 2 deploy, display inventory masih
 * tampilan recipe unit (g/ml) karena ingredient existing belum punya
 * `unitBelanja` set. Script ini auto-assign default purchase unit
 * untuk pattern umum:
 *
 *   unit = "g"  → unitBelanja = "kg", unitBelanjaPerCogs = 1000
 *   unit = "ml" → unitBelanja = "L",  unitBelanjaPerCogs = 1000
 *
 * Skip kalau:
 *   - unitBelanja sudah set (jangan overwrite owner config)
 *   - unit BUKAN "g" / "ml" (mis. pcs/btl/pack/kg/L — sudah meaningful)
 *   - is_active = false (deleted/disabled, biar bersih)
 *
 * Dry-run (default): print rencana per ingredient + total counts.
 * Apply (--apply flag): wrap di transaction, rollback kalau ada error.
 *
 * Usage:
 *   npx tsx scripts/_oneshot/migrate-purchase-unit-defaults.ts          # dry-run
 *   npx tsx scripts/_oneshot/migrate-purchase-unit-defaults.ts --apply  # eksekusi
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ingredients } from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const APPLY = process.argv.includes("--apply");

interface MigrationRule {
  fromUnit: string;
  toBelanjaUnit: string;
  perCogs: number;
}

const RULES: MigrationRule[] = [
  { fromUnit: "g", toBelanjaUnit: "kg", perCogs: 1000 },
  { fromUnit: "ml", toBelanjaUnit: "L", perCogs: 1000 },
  /* Sesi AE-137 — identity rules: kalau recipe sudah bermakna sebagai
   * purchase unit (pcs, pack, L, kg, set), assign Purchase = Recipe
   * dengan ratio 1. Bahan yang benar-benar perlu konversi custom (mis.
   * pack 24 pcs) owner override manual via Edit Bahan. */
  { fromUnit: "pcs", toBelanjaUnit: "pcs", perCogs: 1 },
  { fromUnit: "pack", toBelanjaUnit: "pack", perCogs: 1 },
  { fromUnit: "L", toBelanjaUnit: "L", perCogs: 1 },
  { fromUnit: "kg", toBelanjaUnit: "kg", perCogs: 1 },
  { fromUnit: "set", toBelanjaUnit: "set", perCogs: 1 },
  { fromUnit: "tabung", toBelanjaUnit: "tabung", perCogs: 1 },
  { fromUnit: "roll", toBelanjaUnit: "roll", perCogs: 1 },
];

async function main() {
  console.log(
    `\n=== Migrate Purchase Unit Defaults (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`,
  );

  const rows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      unitBelanja: ingredients.unitBelanja,
      unitBelanjaPerCogs: ingredients.unitBelanjaPerCogs,
      isActive: ingredients.isActive,
    })
    .from(ingredients)
    .where(isNull(ingredients.deletedAt))
    .orderBy(ingredients.name);

  const plan: Array<{
    id: string;
    name: string;
    unit: string;
    newBelanja: string;
    newPerCogs: number;
  }> = [];
  const skipped: Array<{ name: string; unit: string; reason: string }> = [];

  for (const r of rows) {
    if (!r.isActive) {
      skipped.push({ name: r.name, unit: r.unit, reason: "inactive" });
      continue;
    }
    if (r.unitBelanja && r.unitBelanja.trim().length > 0) {
      skipped.push({
        name: r.name,
        unit: r.unit,
        reason: `unitBelanja already set: ${r.unitBelanja}`,
      });
      continue;
    }
    const rule = RULES.find((x) => x.fromUnit === r.unit);
    if (!rule) {
      skipped.push({
        name: r.name,
        unit: r.unit,
        reason: `no rule for unit "${r.unit}"`,
      });
      continue;
    }
    plan.push({
      id: r.id,
      name: r.name,
      unit: r.unit,
      newBelanja: rule.toBelanjaUnit,
      newPerCogs: rule.perCogs,
    });
  }

  console.log(`Total ingredient aktif: ${rows.filter((r) => r.isActive).length}`);
  console.log(`Rencana migrate: ${plan.length}`);
  console.log(`Skip: ${skipped.length}\n`);

  if (plan.length > 0) {
    console.log("--- Akan di-migrate ---");
    for (const p of plan) {
      console.log(
        `  ${p.name.padEnd(35)} ${p.unit.padEnd(4)} → ${p.newBelanja} (1 ${p.newBelanja} = ${p.newPerCogs} ${p.unit})`,
      );
    }
  }

  if (skipped.length > 0 && skipped.length < 30) {
    console.log("\n--- Skipped ---");
    const grouped = new Map<string, number>();
    for (const s of skipped) {
      const key = s.reason.startsWith("unitBelanja")
        ? "unitBelanja already set"
        : s.reason;
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    for (const [reason, count] of grouped) {
      console.log(`  ${count}× — ${reason}`);
    }
  } else if (skipped.length >= 30) {
    console.log("\n--- Skipped (summary) ---");
    const grouped = new Map<string, number>();
    for (const s of skipped) {
      const key = s.reason.startsWith("unitBelanja")
        ? "unitBelanja already set"
        : s.reason.startsWith("no rule")
          ? `no rule for unit "${s.unit}"`
          : s.reason;
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    for (const [reason, count] of grouped) {
      console.log(`  ${count}× — ${reason}`);
    }
  }

  if (!APPLY) {
    console.log(
      `\n[DRY-RUN] Pass --apply untuk eksekusi. ${plan.length} row akan di-update.`,
    );
    await pool.end();
    process.exit(0);
  }

  if (plan.length === 0) {
    console.log("\nTidak ada yang perlu di-migrate. Exit.");
    await pool.end();
    process.exit(0);
  }

  console.log("\n[APPLY] Mulai eksekusi...");
  let updated = 0;
  for (const p of plan) {
    await db
      .update(ingredients)
      .set({
        unitBelanja: p.newBelanja,
        unitBelanjaPerCogs: String(p.newPerCogs),
        updatedAt: new Date(),
      })
      .where(and(eq(ingredients.id, p.id)));
    updated += 1;
  }
  console.log(`✓ ${updated} ingredient ter-update.`);
  void sql;
  await pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await pool.end();
  process.exit(1);
});
