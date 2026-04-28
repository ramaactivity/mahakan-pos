/**
 * `npm run inventory:import` — parse 5 CSV file, validate, reconcile, and
 * (with --apply) write to DB. Default = dry-run.
 *
 * Workflow:
 *   1. npm run inventory:template
 *   2. Edit data/templates/*.csv (atau hasil inventory:export)
 *   3. Move ke data/source-spreadsheets/ atau gunakan --source path
 *   4. npm run inventory:import           # dry-run, no DB writes
 *   5. npm run inventory:import -- --apply   # commit
 *
 * Flags:
 *   --source <path>    direktori berisi 5 CSV (default: data/source-spreadsheets)
 *   --apply            tulis ke DB; default = dry-run
 *   --outlet <uuid>    override outlet auto-detect (kalau >1 outlet di DB)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parseCsv } from "./_shared/csv-io";
import { getBool, getString, parseCliArgs } from "./_shared/cli-args";
import { resolveOutlet } from "./_shared/outlet-resolver";
import { resolveActorUserId } from "./_shared/actor-resolver";
import {
  IMPORT_FILE_NAMES,
  runImport,
  type ImportInput,
  type RunRow,
} from "@/features/inventory/import-engine";
import {
  normalizeIngredientRow,
  normalizeMenuRecipeLineRow,
  normalizeMenuRecipeRow,
  normalizePrepLineRow,
  normalizePreparationRow,
  type ParsedIngredientRow,
  type ParsedMenuRecipeLineRow,
  type ParsedMenuRecipeRow,
  type ParsedPrepLineRow,
  type ParsedPreparationRow,
  type RowError,
} from "@/features/inventory/import-engine-pure";
import { logAudit } from "@/lib/audit/logger";

interface ParseFileResult<T> {
  rows: RunRow<T>[];
  errors: Array<{ file: string; error: RowError }>;
  parsed: number;
  skipped: number;
}

function loadFile<T>(
  filePath: string,
  fileName: string,
  normalize: (
    raw: Record<string, string>,
    row: number,
  ) => { row?: T; errors: RowError[]; skipped?: "empty" | "example" },
): ParseFileResult<T> {
  const result: ParseFileResult<T> = { rows: [], errors: [], parsed: 0, skipped: 0 };
  const parsed = parseCsv<Record<string, string>>(filePath);
  for (const e of parsed.errors) {
    result.errors.push({ file: fileName, error: { row: e.row, message: e.message } });
  }
  for (let i = 0; i < parsed.rows.length; i++) {
    const raw = parsed.rows[i];
    const fileRow = parsed.rowNumbers[i];
    const norm = normalize(raw, fileRow);
    if (norm.skipped) {
      result.skipped++;
      continue;
    }
    if (norm.errors.length > 0) {
      for (const err of norm.errors) {
        result.errors.push({ file: fileName, error: err });
      }
      continue;
    }
    if (norm.row) {
      result.rows.push({ row: fileRow, data: norm.row });
      result.parsed++;
    }
  }
  return result;
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

function printSummary(label: string, counts: Record<string, number>) {
  const parts = Object.entries(counts).map(([k, v]) => `${v} ${k.toUpperCase()}`).join(", ");
  console.log(`  ${pad(label, 20)} (${parts})`);
}

async function main() {
  const args = parseCliArgs();
  const apply = getBool(args, "apply");
  const sourceArg = getString(args, "source");
  const outletOverride = getString(args, "outlet");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set in .env.local");
  }

  const source = resolve(process.cwd(), sourceArg ?? "data/source-spreadsheets");
  if (!existsSync(source)) {
    throw new Error(`Source dir not found: ${source}`);
  }

  console.log(`Source: ${source}`);
  console.log(`Mode:   ${apply ? "APPLY (writes ke DB)" : "DRY-RUN (no writes)"}\n`);

  // Load + parse 5 files.
  const ing = loadFile<ParsedIngredientRow>(
    resolve(source, "01-ingredients.csv"),
    "01-ingredients.csv",
    normalizeIngredientRow,
  );
  const prep = loadFile<ParsedPreparationRow>(
    resolve(source, "02-preparations.csv"),
    "02-preparations.csv",
    normalizePreparationRow,
  );
  const prepLines = loadFile<ParsedPrepLineRow>(
    resolve(source, "03-preparation-lines.csv"),
    "03-preparation-lines.csv",
    normalizePrepLineRow,
  );
  const menuRecipes = loadFile<ParsedMenuRecipeRow>(
    resolve(source, "04-menu-recipes.csv"),
    "04-menu-recipes.csv",
    normalizeMenuRecipeRow,
  );
  const menuRecipeLines = loadFile<ParsedMenuRecipeLineRow>(
    resolve(source, "05-menu-recipe-lines.csv"),
    "05-menu-recipe-lines.csv",
    normalizeMenuRecipeLineRow,
  );

  console.log(`Parsed:`);
  console.log(`  ${pad(IMPORT_FILE_NAMES.ingredients, 30)} ${ing.parsed} valid, ${ing.skipped} skipped, ${ing.errors.length} errors`);
  console.log(`  ${pad(IMPORT_FILE_NAMES.preparations, 30)} ${prep.parsed} valid, ${prep.skipped} skipped, ${prep.errors.length} errors`);
  console.log(`  ${pad(IMPORT_FILE_NAMES.prepLines, 30)} ${prepLines.parsed} valid, ${prepLines.skipped} skipped, ${prepLines.errors.length} errors`);
  console.log(`  ${pad(IMPORT_FILE_NAMES.menuRecipes, 30)} ${menuRecipes.parsed} valid, ${menuRecipes.skipped} skipped, ${menuRecipes.errors.length} errors`);
  console.log(`  ${pad(IMPORT_FILE_NAMES.menuRecipeLines, 30)} ${menuRecipeLines.parsed} valid, ${menuRecipeLines.skipped} skipped, ${menuRecipeLines.errors.length} errors`);
  console.log();

  // Surface parse-level errors immediately (won't proceed to DB).
  const parseErrors = [
    ...ing.errors,
    ...prep.errors,
    ...prepLines.errors,
    ...menuRecipes.errors,
    ...menuRecipeLines.errors,
  ];
  if (parseErrors.length > 0) {
    console.log(`Parse errors:`);
    for (const e of parseErrors) {
      console.log(
        `  [ERROR] ${e.file} row ${e.error.row}${e.error.field ? ` (${e.error.field})` : ""}: ${e.error.message}`,
      );
    }
    console.log();
    if (apply) {
      console.log(`Refusing apply: fix parse errors dulu.`);
      process.exit(1);
    }
  }

  // Resolve outlet + actor.
  const outlet = await resolveOutlet(outletOverride);
  const actorUserId = await resolveActorUserId();
  const runId = randomUUID();
  console.log(`Outlet:    ${outlet.outletId}  (${outlet.outletName})`);
  console.log(`Actor:     ${actorUserId ?? "(no SEED_OWNER_EMAIL — audit will use null)"}`);
  console.log(`Run ID:    ${runId}\n`);

  const input: ImportInput = {
    ingredients: ing.rows,
    preparations: prep.rows,
    prepLines: prepLines.rows,
    menuRecipes: menuRecipes.rows,
    menuRecipeLines: menuRecipeLines.rows,
  };

  const report = await runImport(input, {
    outletId: outlet.outletId,
    userId: actorUserId,
    apply,
    runId,
  });

  // Print per-file actions.
  function printActionList(label: string, actions: typeof report.ingredients) {
    if (actions.length === 0) return;
    console.log(`${label}:`);
    for (const a of actions) {
      const tag = `[${a.action}]`;
      console.log(
        `  ${pad(tag, 10)} row ${pad(String(a.row), 4)} ${a.name}${a.detail ? `  — ${a.detail}` : ""}`,
      );
    }
  }
  printActionList("File 01 (ingredients)", report.ingredients);
  printActionList("File 02 (preparations)", report.preparations);
  printActionList("File 03 (preparation lines)", report.prepLines);
  printActionList("File 04 (menu recipes)", report.menuRecipes);
  printActionList("File 05 (menu recipe lines)", report.menuRecipeLines);

  // Engine-level errors (cross-file).
  if (report.errors.length > 0) {
    console.log(`\nValidation errors:`);
    for (const e of report.errors) {
      console.log(
        `  [ERROR] ${e.file}${e.error.row > 0 ? ` row ${e.error.row}` : ""}: ${e.error.message}`,
      );
    }
  }

  console.log(`\nSummary:`);
  printSummary("ingredients", report.counts.ingredients);
  printSummary("preparations", report.counts.preparations);
  printSummary("prep_lines", report.counts.prepLines);
  printSummary("menu_recipes", report.counts.menuRecipes);
  printSummary("menu_recipe_lines", report.counts.menuRecipeLines);

  // JSON sidecar for machine consumers.
  const reportDir = resolve(process.cwd(), "data/exports", `import-${runId.slice(0, 8)}`);
  mkdirSync(reportDir, { recursive: true });
  const reportPath = resolve(reportDir, "import-report.json");
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        runId,
        timestamp: new Date().toISOString(),
        source,
        outlet: { id: outlet.outletId, name: outlet.outletName },
        mode: apply ? "apply" : "dry-run",
        committed: apply && !report.hasErrors,
        ...report,
      },
      null,
      2,
    ),
    "utf-8",
  );

  if (apply && !report.hasErrors) {
    // Emit summary audit event (1 per run).
    await logAudit({
      eventType: "inventory.import.run",
      userId: actorUserId ?? undefined,
      entityType: "import_run",
      entityId: runId,
      payload: {
        summary: `Import: ${report.counts.ingredients.new + report.counts.preparations.new} NEW, ${report.counts.ingredients.update + report.counts.preparations.update + report.counts.menuRecipes.update} UPDATE`,
        after: {
          runId,
          source,
          counts: report.counts,
        },
      },
      metadata: {
        outletId: outlet.outletId,
        actorRole: "import-cli",
      },
    });
    console.log(`\nCOMMITTED. Audit event emitted (runId=${runId}).`);
    console.log(`Report: ${reportPath}`);
  } else if (apply && report.hasErrors) {
    console.log(`\nREFUSED. Errors found — no DB writes. Report: ${reportPath}`);
    process.exit(1);
  } else {
    const errCount = report.hasErrors ? "with errors" : "clean";
    console.log(`\nDRY RUN ${errCount}; no writes.`);
    console.log(`Report: ${reportPath}`);
    if (!report.hasErrors) {
      console.log(`Re-run with --apply to commit.`);
    } else {
      console.log(`Fix errors di CSV dan re-run.`);
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
