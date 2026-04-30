/**
 * `npm run seed:mock-stock` — fill mock initial stock + reorder threshold for
 * existing ingredients that haven't been seeded yet. Idempotent: skips any
 * ingredient that already has an `inventory_movements.kind = 'initial'`.
 *
 * Default = dry-run (no DB writes). Use --apply to commit.
 *
 * Logic:
 *   - qty awal: unit-aware random (gram/ml: 1000-5000, kg/L: 5-20,
 *     pcs/bh/pack/dus: 20-100, butir/lembar/slice: 30-100, default: 50)
 *   - reorder_threshold = round(qty × 0.2)
 *   - logs an `initial` movement with unit_cost_at_movement = current cost_per_unit
 *
 * Run:
 *   npm run seed:mock-stock              # dry-run
 *   npm run seed:mock-stock -- --apply   # commit
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull } from "drizzle-orm";
import { ingredients, inventoryMovements, outlets, users } from "@/db/schema";
import { getBool, getString, parseCliArgs } from "./_shared/cli-args";

interface QtyRange {
  min: number;
  max: number;
}

const UNIT_RANGES: Array<{ match: RegExp; range: QtyRange }> = [
  { match: /^(g|gr|gram|grams|ml|milliliter)$/i, range: { min: 1000, max: 5000 } },
  { match: /^(kg|kilogram|l|liter|litre)$/i, range: { min: 5, max: 20 } },
  {
    match: /^(pcs|bh|buah|pack|packs|pak|dus|btl|botol|tbg|tabung|gulung|galon|set)$/i,
    range: { min: 20, max: 100 },
  },
  { match: /^(butir|lembar|slice|sheet|helai)$/i, range: { min: 30, max: 100 } },
];
const DEFAULT_RANGE: QtyRange = { min: 30, max: 100 };

function pickRange(unit: string): QtyRange {
  for (const { match, range } of UNIT_RANGES) {
    if (match.test(unit.trim())) return range;
  }
  return DEFAULT_RANGE;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  const args = parseCliArgs();
  const apply = getBool(args, "apply");
  const outletOverride = getString(args, "outlet");

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set in .env.local");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  // Resolve outlet (auto if single, override if --outlet supplied).
  let outletId: string;
  let outletName: string;
  if (outletOverride) {
    const [row] = await db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(eq(outlets.id, outletOverride))
      .limit(1);
    if (!row) throw new Error(`Outlet --outlet=${outletOverride} tidak ditemukan`);
    outletId = row.id;
    outletName = row.name;
  } else {
    const rows = await db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(isNull(outlets.deletedAt));
    if (rows.length === 0) throw new Error("Tidak ada outlet aktif di DB");
    if (rows.length > 1) {
      const list = rows.map((r) => `  - ${r.id}  ${r.name}`).join("\n");
      throw new Error(`Multiple outlets, pakai --outlet <uuid>:\n${list}`);
    }
    outletId = rows[0].id;
    outletName = rows[0].name;
  }

  // Resolve actor for audit (SEED_OWNER_EMAIL).
  const actorEmail = process.env.SEED_OWNER_EMAIL;
  let actorId: string | null = null;
  if (actorEmail) {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, actorEmail))
      .limit(1);
    actorId = row?.id ?? null;
  }

  console.log(`Mode:    ${apply ? "APPLY (will write)" : "DRY-RUN (no writes)"}`);
  console.log(`Outlet:  ${outletName} (${outletId})`);
  console.log(`Actor:   ${actorId ?? "(none — SEED_OWNER_EMAIL unset)"}`);
  console.log("");

  // 1. Load all active ingredients for this outlet.
  const allIngredients = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      costPerUnit: ingredients.costPerUnit,
      currentStock: ingredients.currentStock,
      reorderThreshold: ingredients.reorderThreshold,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, outletId),
        eq(ingredients.isActive, true),
        isNull(ingredients.deletedAt),
      ),
    )
    .orderBy(ingredients.name);

  console.log(`Found ${allIngredients.length} active ingredients.`);

  // 2. Fetch all 'initial' movements for this outlet — bounded by ingredient
  //    count, so safe without IN-list binding.
  const seededIds = new Set<string>();
  const existing = await db
    .select({ ingredientId: inventoryMovements.ingredientId })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.outletId, outletId),
        eq(inventoryMovements.kind, "initial"),
      ),
    );
  for (const r of existing) seededIds.add(r.ingredientId);

  // 3. Plan changes.
  type Plan = {
    id: string;
    name: string;
    unit: string;
    costPerUnit: number;
    qty: number;
    threshold: number;
  };
  const plans: Plan[] = [];
  let skipped = 0;
  for (const ing of allIngredients) {
    if (seededIds.has(ing.id)) {
      skipped++;
      continue;
    }
    const range = pickRange(ing.unit);
    const qty = randInt(range.min, range.max);
    const threshold = Math.round(qty * 0.2);
    plans.push({
      id: ing.id,
      name: ing.name,
      unit: ing.unit,
      costPerUnit: ing.costPerUnit,
      qty,
      threshold,
    });
  }

  console.log(`Plan: seed=${plans.length}  skip=${skipped}  total=${allIngredients.length}\n`);

  // Print first 20 + last 5 of plan for review.
  const previewLimit = 20;
  for (let i = 0; i < Math.min(plans.length, previewLimit); i++) {
    const p = plans[i];
    console.log(
      `  ${String(i + 1).padStart(3)}. ${p.name.padEnd(40)}  qty=${String(p.qty).padStart(5)} ${p.unit.padEnd(6)}  threshold=${p.threshold}`,
    );
  }
  if (plans.length > previewLimit) {
    console.log(`  ... ${plans.length - previewLimit} more`);
  }

  if (!apply) {
    console.log("\n[DRY-RUN] No DB writes. Re-run with --apply to commit.");
    await pool.end();
    process.exit(0);
  }

  if (plans.length === 0) {
    console.log("\nNothing to seed. Done.");
    await pool.end();
    process.exit(0);
  }

  // 4. Apply: wrap in transaction.
  console.log("\nApplying changes...");
  await db.transaction(async (tx) => {
    for (const p of plans) {
      await tx
        .update(ingredients)
        .set({
          currentStock: p.qty,
          reorderThreshold: p.threshold,
          updatedAt: new Date(),
          updatedBy: actorId,
        })
        .where(eq(ingredients.id, p.id));

      await tx.insert(inventoryMovements).values({
        outletId,
        ingredientId: p.id,
        kind: "initial",
        qtyDelta: p.qty,
        unitCostAtMovement: p.costPerUnit,
        referenceType: "manual",
        reason: "Mock stock-take seed (sesi G)",
        createdBy: actorId,
      });
    }
  });

  console.log(`✅ Seeded ${plans.length} ingredients (skipped ${skipped} already-seeded).`);
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
