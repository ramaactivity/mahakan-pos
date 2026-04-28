/**
 * Read-only verification of M23.5 import. Counts + sample cost values.
 * Run: npx tsx scripts/_oneshot/verify-import.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  const counts = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM ingredients WHERE deleted_at IS NULL AND is_preparation=false) AS atomic_ingredients,
      (SELECT COUNT(*) FROM ingredients WHERE deleted_at IS NULL AND is_preparation=true) AS preparations,
      (SELECT COUNT(*) FROM recipes WHERE is_active=true) AS active_recipes,
      (SELECT COUNT(*) FROM recipe_ingredients) AS recipe_lines,
      (SELECT COUNT(*) FROM audit_logs WHERE event_type='inventory.import.run') AS import_runs
  `);
  console.log("DB counts:");
  console.log(counts.rows[0]);

  const sampleCosts = await db.execute(sql`
    SELECT name, unit, cost_per_unit
    FROM ingredients
    WHERE deleted_at IS NULL
      AND name IN ('Prep - Espresso HB', 'Prep - Creamer', 'Prep - Nasi', 'Prep - Sambal Matah', 'Prep - Ayam Popcorn', 'Beans Houseblend', 'Susu Omela')
    ORDER BY name
  `);
  console.log("\nSample costs (atomic + computed prep):");
  for (const r of sampleCosts.rows) {
    console.log(`  ${r.name}: Rp ${r.cost_per_unit}/${r.unit}`);
  }

  const lastImport = await db.execute(sql`
    SELECT entity_id, payload, metadata, created_at
    FROM audit_logs
    WHERE event_type='inventory.import.run'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  console.log("\nLast import.run audit event:");
  console.log(JSON.stringify(lastImport.rows[0], null, 2));

  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
