/**
 * Sesi AE-137 — Audit semua ingredient + unit (recipe + purchase + ratio).
 * Owner request: cek inconsistency + missing purchase unit, propose bulk fix.
 *
 * Read-only. Output ke stdout dengan kategori:
 *   - inconsistent (recipe "gram" should be "g", "Pack" lowercase, etc)
 *   - missing_purchase (active ingredient tanpa purchase unit)
 *   - rare_unit (purchase atau recipe yang belum di preset UI)
 *   - identity_pair (recipe == purchase = OK identity)
 *   - happy_path (kg/g, L/ml, pack/pcs sudah benar)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, isNull, sql } from "drizzle-orm";
import { ingredients } from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

/* Preset yang nanti tersedia di UI form. Apapun di luar ini = "lainnya". */
const PRESET_RECIPE_UNITS = new Set(["g", "ml", "pcs"]);
const PRESET_PURCHASE_UNITS = new Set([
  "kg",
  "L",
  "btl",
  "pack",
  "karton",
  "pcs",
  "galon",
  "tabung",
  "pax",
  "kaleng",
  "dus",
  "renceng",
  "pail",
  "bal",
  "lusin",
  "set",
  "roll",
  "sachet",
  "ikat",
  "kotak",
  "bks",
  "btg",
]);

/* Common alias yang harus di-normalize (case + spelling). */
const RECIPE_ALIAS: Record<string, string> = {
  gram: "g",
  Gram: "g",
  GRAM: "g",
  GR: "g",
  gr: "g",
  Pcs: "pcs",
  PCS: "pcs",
  Pack: "pcs", // edge case: kalau "Pack" jadi recipe unit, biasanya maksudnya pcs (per buah)
  Ml: "ml",
  ML: "ml",
};
const PURCHASE_ALIAS: Record<string, string> = {
  Kg: "kg",
  KG: "kg",
  l: "L",
  liter: "L",
  Liter: "L",
  LITER: "L",
  Botol: "btl",
  botol: "btl",
  Pack: "pack",
  PACK: "pack",
  Karton: "karton",
  KARTON: "karton",
  Pcs: "pcs",
  PCS: "pcs",
  Galon: "galon",
  Tabung: "tabung",
  Kaleng: "kaleng",
  Dus: "dus",
  Renceng: "renceng",
  Pail: "pail",
  Bal: "bal",
  Set: "set",
  Roll: "roll",
  Ikat: "ikat",
  Kotak: "kotak",
  Bks: "bks",
};

interface AuditRow {
  id: string;
  name: string;
  unit: string;
  unitBelanja: string | null;
  unitBelanjaPerCogs: string | null;
  proposedRecipe?: string;
  proposedPurchase?: string;
  proposedRatio?: number;
  flags: string[];
}

async function main() {
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
    .where(and(isNull(ingredients.deletedAt)))
    .orderBy(ingredients.name);

  const audit: AuditRow[] = [];

  for (const r of rows) {
    if (!r.isActive) continue;
    const flags: string[] = [];
    let proposedRecipe: string | undefined;
    let proposedPurchase: string | undefined;
    let proposedRatio: number | undefined;

    /* Recipe unit normalisasi. */
    const recipeRaw = r.unit;
    if (RECIPE_ALIAS[recipeRaw]) {
      proposedRecipe = RECIPE_ALIAS[recipeRaw];
      flags.push(`recipe_alias("${recipeRaw}"→"${proposedRecipe}")`);
    } else if (!PRESET_RECIPE_UNITS.has(recipeRaw)) {
      flags.push(`rare_recipe("${recipeRaw}")`);
    }

    /* Purchase unit normalisasi. */
    if (r.unitBelanja) {
      const purchaseRaw = r.unitBelanja.trim();
      if (PURCHASE_ALIAS[purchaseRaw]) {
        proposedPurchase = PURCHASE_ALIAS[purchaseRaw];
        flags.push(
          `purchase_alias("${purchaseRaw}"→"${proposedPurchase}")`,
        );
      } else if (!PRESET_PURCHASE_UNITS.has(purchaseRaw)) {
        flags.push(`rare_purchase("${purchaseRaw}")`);
      }
      /* Validate ratio. */
      const per = r.unitBelanjaPerCogs
        ? parseFloat(r.unitBelanjaPerCogs)
        : null;
      if (per === null || per <= 0) {
        flags.push("missing_ratio");
      }
    } else {
      flags.push("missing_purchase");
    }

    /* Specific known-suspicious pairs (potential human error). */
    const recipe = proposedRecipe ?? recipeRaw;
    const purchase = proposedPurchase ?? r.unitBelanja?.trim();
    if (recipe === "ml" && purchase === "kg") {
      flags.push("SUSPICIOUS: ml + kg pair (likely should be L+ml or kg+g)");
    }
    if (recipe === "g" && purchase === "L") {
      flags.push("SUSPICIOUS: g + L pair");
    }

    if (flags.length > 0) {
      audit.push({
        id: r.id,
        name: r.name,
        unit: r.unit,
        unitBelanja: r.unitBelanja,
        unitBelanjaPerCogs: r.unitBelanjaPerCogs,
        proposedRecipe,
        proposedPurchase,
        proposedRatio,
        flags,
      });
    }
  }

  console.log(
    `\n=== Ingredient Unit Audit (${rows.filter((r) => r.isActive).length} aktif) ===\n`,
  );

  const byFlag = new Map<string, AuditRow[]>();
  for (const row of audit) {
    /* Pakai flag pertama sebagai primary kategori. */
    const primary = row.flags[0].split("(")[0].split(":")[0].trim();
    if (!byFlag.has(primary)) byFlag.set(primary, []);
    byFlag.get(primary)!.push(row);
  }

  for (const [flag, items] of byFlag) {
    console.log(`\n--- ${flag.toUpperCase()} (${items.length}) ---`);
    for (const r of items.slice(0, 30)) {
      const tags = r.flags
        .map((f) => f.replace(/^[a-z_]+/, ""))
        .filter((f) => f.length > 0)
        .join(" ");
      console.log(
        `  ${r.name.padEnd(30)} recipe="${r.unit}" purchase="${r.unitBelanja ?? "—"}" per=${r.unitBelanjaPerCogs ?? "—"}   ${tags}`,
      );
    }
    if (items.length > 30) {
      console.log(`  ... ${items.length - 30} more`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total aktif: ${rows.filter((r) => r.isActive).length}`);
  console.log(`Total ber-flag: ${audit.length}`);
  console.log(`OK (no flag): ${rows.filter((r) => r.isActive).length - audit.length}`);

  void sql;
  await pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await pool.end();
  process.exit(1);
});
