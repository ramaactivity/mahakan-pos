/**
 * `npm run seed:bulk-ingredients` — One-shot bulk insert ingredients dari
 * CSV tunggal. Bypass `@/db` server-only guard pakai direct neon Pool
 * (sama pattern dengan seed-suppliers-and-sections).
 *
 * Use case: Owner punya CSV daftar bahan baru yang belum di DB.
 * Idempotent: skip kalau name sudah ada (case-insensitive).
 *
 * Default file: seed-data/import-45-new/01-ingredients.csv
 * Override:    --file <path>
 *
 * CSV format (sama dengan template inventory:import):
 *   name,unit,cost_per_unit,initial_stock,reorder_threshold,notes
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import Papa from "papaparse";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull } from "drizzle-orm";
import { ingredients, outlets, users } from "@/db/schema";
import { getBool, getString, parseCliArgs } from "./_shared/cli-args";

interface CsvRow {
  name: string;
  unit: string;
  cost_per_unit: string;
  initial_stock: string;
  reorder_threshold: string;
  notes: string;
}

function normalizeName(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const dryRun = getBool(args, "dry-run");
  const fileArg = getString(args, "file");
  const fileIn =
    fileArg ?? "seed-data/import-45-new/01-ingredients.csv";
  const fullPath = resolve(process.cwd(), fileIn);

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set in .env.local");
    process.exit(1);
  }
  if (!existsSync(fullPath)) {
    console.error(`CSV not found: ${fullPath}`);
    process.exit(1);
  }

  console.log(`File:    ${fullPath}`);
  console.log(`Dry-run: ${dryRun ? "YES" : "NO"}\n`);

  const csvText = readFileSync(fullPath, "utf-8");
  const parsed = Papa.parse<CsvRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length > 0) {
    console.error("Parse errors:");
    for (const e of parsed.errors) console.error(`  ${e.message}`);
    process.exit(1);
  }

  const rows = parsed.data.filter((r) => r.name && r.name.trim().length > 0);
  console.log(`Parsed ${rows.length} rows from CSV`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const [outlet] = await db.select().from(outlets).limit(1);
  if (!outlet) {
    console.error("No outlet found.");
    process.exit(1);
  }
  const [sysUser] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, "owner"), isNull(users.deletedAt)))
    .limit(1);
  if (!sysUser) {
    console.error("No owner user found.");
    process.exit(1);
  }

  // Existing ingredients (case-insensitive name lookup).
  const existing = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, outlet.id),
        isNull(ingredients.deletedAt),
      ),
    );
  const existingByNorm = new Set(existing.map((e) => normalizeName(e.name)));

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const name = row.name.trim();
    const unit = (row.unit ?? "pcs").trim() || "pcs";
    const cost = parseInt(row.cost_per_unit ?? "0", 10) || 0;
    const initial = parseInt(row.initial_stock ?? "0", 10) || 0;
    const thresholdRaw = (row.reorder_threshold ?? "").trim();
    const threshold =
      thresholdRaw.length > 0 ? parseInt(thresholdRaw, 10) : null;
    const notes = (row.notes ?? "").trim() || null;

    if (existingByNorm.has(normalizeName(name))) {
      skipped++;
      continue;
    }
    if (cost < 0 || initial < 0 || (threshold !== null && threshold < 0)) {
      errors.push(`${name}: invalid negative number`);
      continue;
    }

    if (!dryRun) {
      try {
        await db.insert(ingredients).values({
          outletId: outlet.id,
          name,
          unit,
          costPerUnit: cost,
          currentStock: initial,
          reorderThreshold: threshold,
          notes,
          createdBy: sysUser.id,
          updatedBy: sysUser.id,
        });
      } catch (e) {
        errors.push(
          `${name}: ${e instanceof Error ? e.message : String(e)}`,
        );
        continue;
      }
    }
    inserted++;
  }

  console.log(
    `\n✓ Ingredients: ${inserted} inserted, ${skipped} skipped (already exist), ${errors.length} errors`,
  );
  if (errors.length > 0) {
    console.log("\n⚠ Errors:");
    errors.forEach((e) => console.log("  - " + e));
  }
  console.log(
    `\n${dryRun ? "[DRY-RUN] " : ""}Done. ${dryRun ? "Re-run without --dry-run to commit." : ""}`,
  );

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
