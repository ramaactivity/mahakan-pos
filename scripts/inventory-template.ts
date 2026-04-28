/**
 * `npm run inventory:template` — generate 5 blank CSV templates dengan header
 * + 1 example row di `data/templates/`. Refuse-if-exists; pakai `--force`
 * untuk overwrite.
 *
 * Pemakaian (Owner):
 *   1. npm run inventory:template
 *   2. Edit data/templates/*.csv (hapus baris EXAMPLE_DELETE_ME, isi data)
 *   3. Move ke data/source-spreadsheets/ (atau gunakan --source path)
 *   4. npm run inventory:import (dry-run dulu)
 *   5. npm run inventory:import -- --apply (kalau dry-run bersih)
 */
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { writeCsv } from "./_shared/csv-io";
import { getBool, parseCliArgs } from "./_shared/cli-args";

const TEMPLATE_DIR = resolve(process.cwd(), "data/templates");

interface TemplateFile {
  filename: string;
  headers: string[];
  exampleRows: Array<Record<string, string>>;
}

const TEMPLATES: TemplateFile[] = [
  {
    filename: "01-ingredients.csv",
    headers: [
      "name",
      "unit",
      "cost_per_unit",
      "initial_stock",
      "reorder_threshold",
      "notes",
    ],
    exampleRows: [
      {
        name: "EXAMPLE_DELETE_ME",
        unit: "gr",
        cost_per_unit: "1000",
        initial_stock: "0",
        reorder_threshold: "",
        notes: "Hapus baris contoh ini sebelum import",
      },
    ],
  },
  {
    filename: "02-preparations.csv",
    headers: ["name", "unit", "yield", "waste_factor_pct", "notes"],
    exampleRows: [
      {
        name: "EXAMPLE_DELETE_ME",
        unit: "ml",
        yield: "100",
        waste_factor_pct: "10",
        notes: "Hapus baris contoh ini sebelum import",
      },
    ],
  },
  {
    filename: "03-preparation-lines.csv",
    headers: ["prep_name", "ingredient_name", "qty"],
    exampleRows: [
      {
        prep_name: "EXAMPLE_DELETE_ME",
        ingredient_name: "EXAMPLE_DELETE_ME",
        qty: "1",
      },
    ],
  },
  {
    filename: "04-menu-recipes.csv",
    headers: ["menu_name", "variant", "waste_factor_pct", "notes"],
    exampleRows: [
      {
        menu_name: "EXAMPLE_DELETE_ME",
        variant: "",
        waste_factor_pct: "30",
        notes: "Hapus baris contoh ini sebelum import",
      },
    ],
  },
  {
    filename: "05-menu-recipe-lines.csv",
    headers: ["menu_name", "variant", "ingredient_name", "qty"],
    exampleRows: [
      {
        menu_name: "EXAMPLE_DELETE_ME",
        variant: "",
        ingredient_name: "EXAMPLE_DELETE_ME",
        qty: "1",
      },
    ],
  },
];

function main() {
  const args = parseCliArgs();
  const force = getBool(args, "force");

  mkdirSync(TEMPLATE_DIR, { recursive: true });

  console.log(`Generating templates di ${TEMPLATE_DIR}…\n`);

  let written = 0;
  let skipped = 0;
  for (const tpl of TEMPLATES) {
    const path = resolve(TEMPLATE_DIR, tpl.filename);
    if (existsSync(path) && !force) {
      console.log(`  [SKIP]    ${tpl.filename}  (exists; --force untuk overwrite)`);
      skipped++;
      continue;
    }
    writeCsv(path, tpl.exampleRows, {
      headers: tpl.headers,
      refuseOnExist: false,
    });
    console.log(`  [WRITTEN] ${tpl.filename}  (${tpl.headers.length} cols, 1 example row)`);
    written++;
  }

  console.log(
    `\nDone: ${written} written, ${skipped} skipped${skipped > 0 ? " (use --force to overwrite)" : ""}.`,
  );
  console.log(`\nNext steps:`);
  console.log(`  1. Edit data/templates/*.csv (hapus baris EXAMPLE_DELETE_ME, isi data)`);
  console.log(`  2. Move file ke data/source-spreadsheets/ atau gunakan --source flag`);
  console.log(`  3. npm run inventory:import        # dry-run, no DB writes`);
  console.log(`  4. npm run inventory:import -- --apply   # commit ke DB`);
}

try {
  main();
} catch (e) {
  console.error("Error:", e instanceof Error ? e.message : e);
  process.exit(1);
}
