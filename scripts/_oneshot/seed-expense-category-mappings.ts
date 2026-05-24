/**
 * Sesi AE-73 — Backfill expense category → GL account mapping.
 *
 * Existing 11 categories all NO defaultAccountId → expense JE selalu jatuh
 * ke fallback 6901 Lain-lain. P&L jadi tidak akurat (semua expense
 * masuk Lain-lain). Backfill dengan best-fit mapping ke akun GL yang
 * specific.
 *
 * Plus add 6 kategori baru yang missing (Internet, Pemeliharaan, dll).
 *
 * Usage:
 *   npx tsx scripts/_oneshot/seed-expense-category-mappings.ts          # DRY
 *   npx tsx scripts/_oneshot/seed-expense-category-mappings.ts --apply  # FIX
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

const OUTLET_ID = "7c51a6dd-5aaf-47e4-8cf8-ab5426ed0ff4";

interface CategoryConfig {
  name: string;
  glAccountCode: string;
  isSystem: boolean;
  displayOrder: number;
}

/* Mapping kategori → GL account code. Best-fit per category name.
 * Untuk yang overlap (mis. Kemasan vs Bahan Pendukung), pakai code
 * paling natural. Owner bisa edit defaultAccountId per category nanti.
 */
const TARGET_CATEGORIES: CategoryConfig[] = [
  /* Existing — akan di-update defaultAccountId */
  { name: "Belanja Bahan Baku", glAccountCode: "6301", isSystem: false, displayOrder: 1 },
  { name: "Listrik & Air", glAccountCode: "6202", isSystem: false, displayOrder: 2 },
  { name: "Gaji Harian", glAccountCode: "6101", isSystem: false, displayOrder: 3 },
  { name: "Sewa", glAccountCode: "6201", isSystem: false, displayOrder: 4 },
  { name: "Perawatan Alat", glAccountCode: "6302", isSystem: false, displayOrder: 5 },
  { name: "Kemasan", glAccountCode: "6301", isSystem: false, displayOrder: 6 },
  { name: "Marketing", glAccountCode: "6304", isSystem: false, displayOrder: 7 },
  { name: "Lain-lain", glAccountCode: "6901", isSystem: false, displayOrder: 8 },
  { name: "Penyesuaian Saldo Awal", glAccountCode: "6901", isSystem: true, displayOrder: 98 },

  /* NEW kategori yang missing — auto-map ke akun GL yang sudah eksis */
  { name: "Internet & Telepon", glAccountCode: "6204", isSystem: false, displayOrder: 11 },
  { name: "Gas (LPG)", glAccountCode: "6205", isSystem: false, displayOrder: 12 },
  { name: "Pemeliharaan & Perbaikan", glAccountCode: "6302", isSystem: false, displayOrder: 13 },
  { name: "Transportasi", glAccountCode: "6303", isSystem: false, displayOrder: 14 },
  /* Sesi AE-145 — split ATK & Cetak jadi 3 kategori terpisah. */
  { name: "ATK", glAccountCode: "6305", isSystem: false, displayOrder: 15 },
  { name: "Biaya Cetak", glAccountCode: "6306", isSystem: false, displayOrder: 17 },
  { name: "Fotocopy Berkas", glAccountCode: "6307", isSystem: false, displayOrder: 18 },
  { name: "Bahan Pendukung", glAccountCode: "6301", isSystem: false, displayOrder: 16 },
  { name: "Sumbangan Sosial", glAccountCode: "6601", isSystem: false, displayOrder: 20 },
  { name: "Biaya Bank", glAccountCode: "6403", isSystem: false, displayOrder: 21 },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    /* Step 1: resolve GL account code → id */
    const accs = await c.query(
      `SELECT id, code FROM chart_of_accounts
       WHERE outlet_id = $1 AND deleted_at IS NULL`,
      [OUTLET_ID],
    );
    const codeToId = new Map<string, string>();
    for (const r of accs.rows) codeToId.set(r.code, r.id);

    /* Step 2: existing categories */
    const cats = await c.query(
      `SELECT id, name, default_account_id
       FROM expense_categories
       WHERE outlet_id = $1 AND deleted_at IS NULL`,
      [OUTLET_ID],
    );
    const existingByName = new Map<string, { id: string; defaultAccountId: string | null }>();
    for (const r of cats.rows) {
      existingByName.set(r.name, { id: r.id, defaultAccountId: r.default_account_id });
    }

    /* Step 3: plan actions */
    const toUpdate: Array<{ catId: string; name: string; oldAccountId: string | null; newAccountId: string; newAccountCode: string }> = [];
    const toInsert: CategoryConfig[] = [];

    for (const target of TARGET_CATEGORIES) {
      const acctId = codeToId.get(target.glAccountCode);
      if (!acctId) {
        console.warn(`  ⚠ Skip "${target.name}" — GL ${target.glAccountCode} not found`);
        continue;
      }
      const existing = existingByName.get(target.name);
      if (existing) {
        if (existing.defaultAccountId !== acctId) {
          toUpdate.push({
            catId: existing.id,
            name: target.name,
            oldAccountId: existing.defaultAccountId,
            newAccountId: acctId,
            newAccountCode: target.glAccountCode,
          });
        }
      } else {
        toInsert.push(target);
      }
    }

    console.log(`\nUpdate plan:`);
    for (const u of toUpdate) {
      console.log(`  UPDATE ${u.name.padEnd(28)} → ${u.newAccountCode}`);
    }
    console.log(`\nInsert plan:`);
    for (const i of toInsert) {
      console.log(`  INSERT ${i.name.padEnd(28)} → ${i.glAccountCode} (order ${i.displayOrder})`);
    }
    console.log(`\nTotal: ${toUpdate.length} update + ${toInsert.length} insert`);

    if (toUpdate.length === 0 && toInsert.length === 0) {
      console.log("\n✅ Nothing to change.");
      return;
    }
    if (!apply) {
      console.log("\nDRY-RUN. Re-run dengan --apply.");
      return;
    }

    console.log("\nApplying...");
    await c.query("BEGIN");
    try {
      for (const u of toUpdate) {
        await c.query(
          `UPDATE expense_categories
             SET default_account_id = $1, updated_at = now()
           WHERE id = $2`,
          [u.newAccountId, u.catId],
        );
        console.log(`  ✓ updated ${u.name}`);
      }
      for (const i of toInsert) {
        const acctId = codeToId.get(i.glAccountCode);
        await c.query(
          `INSERT INTO expense_categories (outlet_id, name, default_account_id, is_system, display_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, now(), now())`,
          [OUTLET_ID, i.name, acctId, i.isSystem, i.displayOrder],
        );
        console.log(`  ✓ inserted ${i.name}`);
      }
      await c.query("COMMIT");
      console.log(`\n✅ Done.`);
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
