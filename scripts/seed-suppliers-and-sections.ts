/**
 * `npm run seed:suppliers-and-sections` — One-shot import dari spreadsheet
 * lama Owner ke DB:
 *   - `seed-data/List Supplier.csv` → `suppliers` table
 *   - `seed-data/List Bahan Baku.csv` → set `ingredients.section`
 *
 * Idempotent: pakai supplier `name` sebagai natural key (skip kalau sudah ada).
 * Section assignment fuzzy-match (case-insensitive trim, strip suffix gram).
 *
 * Modes:
 *   --dry-run   → print summary only, no DB writes
 *
 * Section enum mapping dari spreadsheet:
 *   "Kitchen", "Kitchen "       → kitchen
 *   "Bar"                       → bar
 *   "Supporting Supplies"
 *   "Suppporting Supplies"      → supporting     (typo 3 P's di spreadsheet)
 *   "Cleaning Supplies"         → cleaning
 *
 * Files location: defaults to `~/Desktop/POS-ERP-MAHAKAN/seed-data/`. Owner
 * pindahin file CSV ke folder itu sebelum run script.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import Papa from "papaparse";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull } from "drizzle-orm";
import {
  ingredients,
  outlets,
  suppliers,
  users,
} from "@/db/schema";
import { getBool, parseCliArgs } from "./_shared/cli-args";

const SEED_DIR = resolve(process.cwd(), "seed-data");
const SUPPLIERS_FILE = resolve(SEED_DIR, "List Supplier.csv");
const BAHAN_FILE = resolve(SEED_DIR, "List Bahan Baku.csv");

type SectionEnum = "kitchen" | "bar" | "supporting" | "cleaning";

function normalizeSection(raw: string | undefined): SectionEnum | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === "kitchen") return "kitchen";
  if (s === "bar") return "bar";
  if (s.includes("supporting") || s.startsWith("suppp")) return "supporting";
  if (s.includes("cleaning")) return "cleaning";
  return null;
}

/** Aggressive name normalization for fuzzy match. */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    // Strip "50gr" / "100 gr" / "1kg" suffix patterns at end.
    .replace(/\s*\d+\s*(gr|gram|g|kg|ml|l|pcs|pack)\s*$/i, "")
    .trim();
}

interface SupplierRow {
  name: string;
  jatuhTempo?: string;
  jenisSupplier?: string;
}

interface BahanRow {
  nama: string;
  section: string;
  satuan?: string;
}

function parseSuppliersCsv(content: string): SupplierRow[] {
  // Spreadsheet header is on row ~10 ("No, Nama Supplier, Jatuh Tempo, Jenis Supplier")
  // and rows have leading empty col. Use header-less parse + manual extract.
  const parsed = Papa.parse<string[]>(content, { skipEmptyLines: true });
  const rows: SupplierRow[] = [];
  for (const r of parsed.data) {
    if (!Array.isArray(r) || r.length < 3) continue;
    const noVal = String(r[1] ?? "").trim();
    const nameVal = String(r[2] ?? "").trim();
    if (!nameVal) continue;
    if (!/^\d+$/.test(noVal)) continue; // skip non-data rows
    rows.push({
      name: nameVal,
      jatuhTempo: String(r[3] ?? "").trim(),
      jenisSupplier: String(r[4] ?? "").trim(),
    });
  }
  return rows;
}

function parseBahanCsv(content: string): BahanRow[] {
  const parsed = Papa.parse<string[]>(content, { skipEmptyLines: true });
  const rows: BahanRow[] = [];
  for (const r of parsed.data) {
    if (!Array.isArray(r) || r.length < 4) continue;
    const noVal = String(r[1] ?? "").trim();
    const nameVal = String(r[2] ?? "").trim();
    const sectionVal = String(r[3] ?? "").trim();
    if (!nameVal) continue;
    if (!/^\d+$/.test(noVal)) continue;
    rows.push({
      nama: nameVal,
      section: sectionVal,
      satuan: String(r[4] ?? "").trim(),
    });
  }
  return rows;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const dryRun = getBool(args, "dry-run");

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set in .env.local");
    process.exit(1);
  }

  if (!existsSync(SUPPLIERS_FILE) || !existsSync(BAHAN_FILE)) {
    console.error(
      `Missing seed files. Expected:\n  ${SUPPLIERS_FILE}\n  ${BAHAN_FILE}`,
    );
    console.error(
      "\nOwner: pindahin CSV dari Drive ke folder seed-data/ dulu.",
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  // Resolve default outlet + system user (first owner) for createdBy.
  const [outlet] = await db.select().from(outlets).limit(1);
  if (!outlet) {
    console.error("No outlet found in DB.");
    process.exit(1);
  }
  const [sysUser] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, "owner"), isNull(users.deletedAt)))
    .limit(1);
  if (!sysUser) {
    console.error("No owner user found — create one first.");
    process.exit(1);
  }

  console.log(
    `Outlet: ${outlet.name} (${outlet.id})\nDry-run: ${dryRun ? "YES" : "NO"}\n`,
  );

  // ============================================================
  // Suppliers
  // ============================================================
  const supplierRows = parseSuppliersCsv(
    readFileSync(SUPPLIERS_FILE, "utf-8"),
  );
  console.log(`Parsed ${supplierRows.length} supplier rows`);

  const existingSuppliers = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.outletId, outlet.id),
        isNull(suppliers.deletedAt),
      ),
    );
  const existingByName = new Set(
    existingSuppliers.map((s) => s.name.toLowerCase().trim()),
  );

  let supInserted = 0;
  let supSkipped = 0;
  for (const row of supplierRows) {
    if (existingByName.has(row.name.toLowerCase().trim())) {
      supSkipped++;
      continue;
    }
    if (!dryRun) {
      await db.insert(suppliers).values({
        outletId: outlet.id,
        name: row.name,
        category: row.jenisSupplier || null,
        defaultPaymentTermDays: 0,
        notes:
          row.jatuhTempo && row.jatuhTempo !== "-"
            ? `Jatuh tempo asli (spreadsheet): ${row.jatuhTempo}`
            : null,
        createdBy: sysUser.id,
      });
    }
    supInserted++;
  }
  console.log(
    `✓ Suppliers: ${supInserted} inserted, ${supSkipped} skipped (already exist)`,
  );

  // ============================================================
  // Ingredient sections
  // ============================================================
  const bahanRows = parseBahanCsv(readFileSync(BAHAN_FILE, "utf-8"));
  console.log(`\nParsed ${bahanRows.length} bahan rows`);

  const dbIngredients = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      section: ingredients.section,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, outlet.id),
        isNull(ingredients.deletedAt),
      ),
    );
  const ingByNorm = new Map<string, (typeof dbIngredients)[number]>();
  for (const ing of dbIngredients) {
    ingByNorm.set(normalizeName(ing.name), ing);
  }

  let matched = 0;
  let alreadySet = 0;
  const unmatched: string[] = [];
  const invalidSection: string[] = [];

  for (const row of bahanRows) {
    const targetSection = normalizeSection(row.section);
    if (!targetSection) {
      invalidSection.push(`${row.nama} (raw: "${row.section}")`);
      continue;
    }
    const norm = normalizeName(row.nama);
    const ing = ingByNorm.get(norm);
    if (!ing) {
      unmatched.push(row.nama);
      continue;
    }
    if (ing.section === targetSection) {
      alreadySet++;
      continue;
    }
    if (!dryRun) {
      await db
        .update(ingredients)
        .set({
          section: targetSection,
          updatedAt: new Date(),
          updatedBy: sysUser.id,
        })
        .where(eq(ingredients.id, ing.id));
    }
    matched++;
  }

  console.log(
    `✓ Sections: ${matched} updated, ${alreadySet} already correct, ${unmatched.length} unmatched, ${invalidSection.length} invalid section`,
  );
  if (unmatched.length > 0) {
    console.log("\n⚠ Unmatched bahan (Owner manual review needed):");
    unmatched.forEach((n) => console.log("  - " + n));
  }
  if (invalidSection.length > 0) {
    console.log("\n⚠ Invalid section values:");
    invalidSection.forEach((n) => console.log("  - " + n));
  }

  console.log(
    `\n${dryRun ? "[DRY-RUN] " : ""}Done. Re-run without --dry-run to commit.`,
  );

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
