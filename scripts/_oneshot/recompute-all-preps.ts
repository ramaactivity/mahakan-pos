/**
 * One-shot fix for M23.5 import bug: cascadeCostUpdate(prepId) only recomputes
 * dependents of changedId, not the changedId itself. For a fresh import where
 * preps are NEW with new recipe lines, we need to call computePrepCost per
 * prep directly (handles nested preps via recursion).
 *
 * Run: npx tsx scripts/_oneshot/recompute-all-preps.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { ingredients, outlets, users } from "@/db/schema";
import { computePrepCost } from "@/features/inventory/preparation-flow";

async function main() {
  // Find single outlet (Mahakan).
  const [outlet] = await db
    .select({ id: outlets.id, name: outlets.name })
    .from(outlets)
    .where(isNull(outlets.deletedAt))
    .limit(1);
  if (!outlet) throw new Error("No outlet found");
  console.log(`Outlet: ${outlet.name} (${outlet.id})`);

  // Resolve actor user id (same as import engine via SEED_OWNER_EMAIL).
  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  if (!ownerEmail) throw new Error("SEED_OWNER_EMAIL not set in .env.local");
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ownerEmail))
    .limit(1);
  if (!user) throw new Error(`User ${ownerEmail} not found`);
  const SYSTEM_USER = user.id;
  console.log(`Actor: ${ownerEmail} (${user.id})`);

  await db.transaction(async (tx) => {
    // Acquire same advisory lock as cascadeCostUpdate.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`cost-cascade-${outlet.id}`}))`,
    );

    const preps = await tx
      .select({ id: ingredients.id, name: ingredients.name, costPerUnit: ingredients.costPerUnit })
      .from(ingredients)
      .where(
        and(
          eq(ingredients.outletId, outlet.id),
          eq(ingredients.isPreparation, true),
          isNull(ingredients.deletedAt),
        ),
      );
    console.log(`Found ${preps.length} preparations to recompute.`);

    const inProgress = new Set<string>();
    const computed = new Map<string, number>();

    for (const p of preps) {
      const before = p.costPerUnit;
      const after = await computePrepCost(
        tx,
        outlet.id,
        p.id,
        SYSTEM_USER,
        inProgress,
        computed,
      );
      const tag = before === after ? "  same" : `${before} → ${after}`;
      console.log(`  ${p.name.padEnd(30)} ${tag}`);
    }
  });

  console.log("\nDone.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
