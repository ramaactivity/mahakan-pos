/**
 * Sesi AE-145 — Inab finance request:
 * "di akun beban buat dipisah antara akun Atk sama Biaya cetak terus
 *  nambahin akun Fotocopy berkas"
 *
 * Plan (atomik):
 *  1. Rename GL 6305 "ATK & Cetak" → "ATK" (keep code; past JE tetap link).
 *  2. ADD GL 6306 "Biaya Cetak" (parent 6300, expense/debit, displayOrder 25).
 *  3. ADD GL 6307 "Fotocopy Berkas" (parent 6300, expense/debit, displayOrder 26).
 *  4. Rename expense_categories.name "ATK & Cetak" → "ATK" (default GL 6305).
 *  5. ADD expense_categories "Biaya Cetak" → GL 6306.
 *  6. ADD expense_categories "Fotocopy Berkas" → GL 6307.
 *  7. Emit audit row "accounting.coa_split" untuk traceability.
 *
 * Dry-run default. Apply: --apply.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull } from "drizzle-orm";
import { auditLogs, chartOfAccounts, outlets, users } from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(
    `\n=== Split ATK & Cetak (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`,
  );

  /* Resolve single outlet. */
  const [outlet] = await db
    .select({ id: outlets.id, name: outlets.name })
    .from(outlets)
    .where(isNull(outlets.deletedAt))
    .limit(1);
  if (!outlet) {
    console.error("Outlet tidak ditemukan.");
    await pool.end();
    process.exit(1);
  }
  console.log(`Outlet: ${outlet.name} (${outlet.id})`);

  /* Cek state CoA sekarang. */
  const coa6305 = await db
    .select({
      id: chartOfAccounts.id,
      code: chartOfAccounts.code,
      name: chartOfAccounts.name,
    })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.outletId, outlet.id),
        eq(chartOfAccounts.code, "6305"),
        isNull(chartOfAccounts.deletedAt),
      ),
    )
    .limit(1);
  const coa6306Existing = await db
    .select({ id: chartOfAccounts.id, name: chartOfAccounts.name })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.outletId, outlet.id),
        eq(chartOfAccounts.code, "6306"),
        isNull(chartOfAccounts.deletedAt),
      ),
    )
    .limit(1);
  const coa6307Existing = await db
    .select({ id: chartOfAccounts.id, name: chartOfAccounts.name })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.outletId, outlet.id),
        eq(chartOfAccounts.code, "6307"),
        isNull(chartOfAccounts.deletedAt),
      ),
    )
    .limit(1);

  console.log(`\nState GL accounts:`);
  console.log(
    `  6305: ${coa6305[0] ? `"${coa6305[0].name}"` : "NOT FOUND"}`,
  );
  console.log(
    `  6306: ${coa6306Existing[0] ? `"${coa6306Existing[0].name}" (sudah ada)` : "BELUM ADA"}`,
  );
  console.log(
    `  6307: ${coa6307Existing[0] ? `"${coa6307Existing[0].name}" (sudah ada)` : "BELUM ADA"}`,
  );

  if (!coa6305[0]) {
    console.error("\nERROR: GL 6305 tidak ditemukan. Re-run seed-accounts.ts dulu.");
    await pool.end();
    process.exit(1);
  }

  /* Cek expense_categories sekarang via raw SQL (tabel expense_categories
   * tidak di-import dari drizzle schema export di sini — pakai raw query). */
  const catClient = await pool.connect();
  let catAtkRow:
    | { id: string; name: string; default_account_id: string | null }
    | null = null;
  let catBiayaCetakRow: { id: string; name: string } | null = null;
  let catFotocopyRow: { id: string; name: string } | null = null;
  try {
    const r1 = await catClient.query(
      `SELECT id, name, default_account_id FROM expense_categories
       WHERE outlet_id = $1 AND name IN ('ATK & Cetak', 'ATK') AND deleted_at IS NULL
       ORDER BY CASE WHEN name='ATK & Cetak' THEN 0 ELSE 1 END LIMIT 1`,
      [outlet.id],
    );
    catAtkRow = r1.rows[0] ?? null;
    const r2 = await catClient.query(
      `SELECT id, name FROM expense_categories
       WHERE outlet_id = $1 AND name = 'Biaya Cetak' AND deleted_at IS NULL LIMIT 1`,
      [outlet.id],
    );
    catBiayaCetakRow = r2.rows[0] ?? null;
    const r3 = await catClient.query(
      `SELECT id, name FROM expense_categories
       WHERE outlet_id = $1 AND name = 'Fotocopy Berkas' AND deleted_at IS NULL LIMIT 1`,
      [outlet.id],
    );
    catFotocopyRow = r3.rows[0] ?? null;
  } finally {
    catClient.release();
  }

  console.log(`\nState expense_categories:`);
  console.log(
    `  ATK/ATK & Cetak: ${catAtkRow ? `"${catAtkRow.name}"` : "BELUM ADA"}`,
  );
  console.log(
    `  Biaya Cetak:     ${catBiayaCetakRow ? `"${catBiayaCetakRow.name}" (sudah ada)` : "BELUM ADA"}`,
  );
  console.log(
    `  Fotocopy Berkas: ${catFotocopyRow ? `"${catFotocopyRow.name}" (sudah ada)` : "BELUM ADA"}`,
  );

  console.log(`\nRencana eksekusi:`);
  const renameCoa = coa6305[0].name === "ATK & Cetak";
  const insertCoa6306 = !coa6306Existing[0];
  const insertCoa6307 = !coa6307Existing[0];
  const renameCat = catAtkRow?.name === "ATK & Cetak";
  const insertCatBiayaCetak = !catBiayaCetakRow;
  const insertCatFotocopy = !catFotocopyRow;
  console.log(
    `  GL 6305 rename: ${renameCoa ? '"ATK & Cetak" → "ATK"' : "SKIP (sudah)"}`,
  );
  console.log(
    `  GL 6306 insert "Biaya Cetak": ${insertCoa6306 ? "YES" : "SKIP"}`,
  );
  console.log(
    `  GL 6307 insert "Fotocopy Berkas": ${insertCoa6307 ? "YES" : "SKIP"}`,
  );
  console.log(
    `  Cat rename: ${renameCat ? '"ATK & Cetak" → "ATK"' : "SKIP (sudah)"}`,
  );
  console.log(
    `  Cat insert "Biaya Cetak": ${insertCatBiayaCetak ? "YES" : "SKIP"}`,
  );
  console.log(
    `  Cat insert "Fotocopy Berkas": ${insertCatFotocopy ? "YES" : "SKIP"}`,
  );

  if (
    !renameCoa &&
    !insertCoa6306 &&
    !insertCoa6307 &&
    !renameCat &&
    !insertCatBiayaCetak &&
    !insertCatFotocopy
  ) {
    console.log("\nNothing to do — semua sudah sesuai.");
    await pool.end();
    process.exit(0);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] Pass --apply untuk eksekusi.`);
    await pool.end();
    process.exit(0);
  }

  /* Resolve actor untuk audit. */
  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  const actor = ownerEmail
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, ownerEmail))
        .limit(1)
    : await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "owner"))
        .limit(1);
  const actorId = actor[0]?.id ?? null;

  console.log(`\n[APPLY] Executing dalam transaction...`);

  const txClient = await pool.connect();
  try {
    await txClient.query("BEGIN");

    /* 1. Rename GL 6305. */
    if (renameCoa) {
      await txClient.query(
        `UPDATE chart_of_accounts
            SET name = 'ATK',
                updated_at = now(),
                updated_by = $1
          WHERE outlet_id = $2 AND code = '6305' AND deleted_at IS NULL`,
        [actorId, outlet.id],
      );
    }

    /* 2. Insert GL 6306 + 6307. */
    let new6306Id: string | null = coa6306Existing[0]?.id ?? null;
    let new6307Id: string | null = coa6307Existing[0]?.id ?? null;

    if (insertCoa6306) {
      const r = await txClient.query(
        `INSERT INTO chart_of_accounts
           (outlet_id, code, name, type, normal_balance, parent_code, is_contra, is_system, is_active, display_order, notes, created_by, updated_by)
         VALUES ($1, '6306', 'Biaya Cetak', 'expense', 'debit', '6300', false, false, true, 25, $2, $3, $3)
         RETURNING id`,
        [
          outlet.id,
          "Manual entry — biaya cetak nota/banner/materi promosi. Sesi AE-145 split dari 6305.",
          actorId,
        ],
      );
      new6306Id = r.rows[0].id;
    }

    if (insertCoa6307) {
      const r = await txClient.query(
        `INSERT INTO chart_of_accounts
           (outlet_id, code, name, type, normal_balance, parent_code, is_contra, is_system, is_active, display_order, notes, created_by, updated_by)
         VALUES ($1, '6307', 'Fotocopy Berkas', 'expense', 'debit', '6300', false, false, true, 26, $2, $3, $3)
         RETURNING id`,
        [
          outlet.id,
          "Manual entry — biaya fotocopy dokumen/berkas (perizinan, kontrak, dst). Sesi AE-145.",
          actorId,
        ],
      );
      new6307Id = r.rows[0].id;
    }

    /* 3. Rename expense_categories "ATK & Cetak" → "ATK". */
    if (renameCat && catAtkRow) {
      await txClient.query(
        `UPDATE expense_categories
            SET name = 'ATK', updated_at = now()
          WHERE id = $1`,
        [catAtkRow.id],
      );
    }

    /* 4. Insert expense_categories baru. */
    if (insertCatBiayaCetak && new6306Id) {
      await txClient.query(
        `INSERT INTO expense_categories
           (outlet_id, name, default_account_id, is_system, display_order, created_at, updated_at)
         VALUES ($1, 'Biaya Cetak', $2, false, 17, now(), now())`,
        [outlet.id, new6306Id],
      );
    }
    if (insertCatFotocopy && new6307Id) {
      await txClient.query(
        `INSERT INTO expense_categories
           (outlet_id, name, default_account_id, is_system, display_order, created_at, updated_at)
         VALUES ($1, 'Fotocopy Berkas', $2, false, 18, now(), now())`,
        [outlet.id, new6307Id],
      );
    }

    await txClient.query("COMMIT");
    console.log(`✓ Transaction committed.`);
  } catch (e) {
    await txClient.query("ROLLBACK");
    console.error("Transaction failed, rolled back:", e);
    txClient.release();
    await pool.end();
    process.exit(1);
  } finally {
    txClient.release();
  }

  /* 5. Audit row (di luar tx — tidak critical). */
  if (actorId) {
    await db.insert(auditLogs).values({
      userId: actorId,
      eventType: "accounting.coa_split",
      entityType: "chart_of_accounts",
      entityId: coa6305[0].id,
      payload: {
        summary:
          "Split 6305 'ATK & Cetak' → 6305 'ATK' + 6306 'Biaya Cetak' + 6307 'Fotocopy Berkas'. Plus expense_categories sync.",
        requestedBy: "Inab finance via Owner request (sesi AE-145)",
        actions: {
          renameCoa,
          insertCoa6306,
          insertCoa6307,
          renameCat,
          insertCatBiayaCetak,
          insertCatFotocopy,
        },
      },
      metadata: {
        actorRole: "owner",
        source: "scripts/_oneshot/split-atk-cetak-accounts.ts",
      },
    });
  }

  console.log(`\n✓ Done. Past JE/expense yang link ke 6305 tetap intact;`);
  console.log(`  hanya label berubah jadi "ATK". Akun baru 6306 + 6307 siap dipakai.`);

  await pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await pool.end();
  process.exit(1);
});
