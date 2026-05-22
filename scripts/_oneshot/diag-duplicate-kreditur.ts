/**
 * Sesi AE-120 — Diagnose duplicate kreditur entries (Rama mis-input).
 *
 * Owner Rama: "saya salah input tadi, jadi ada 4 nama yang sama. tolong
 * dihapus duplikatenya. soalnya saya gabisa disitu ada keterangan harus
 * lunas dulu atau default apa gitu"
 *
 * Strategy:
 *  1. Identify groups of duplicates (same full_name within outlet,
 *     deleted_at IS NULL).
 *  2. For each duplicate group, show all candidates + outstanding principal
 *     + repayment count + journal posted status.
 *  3. Recommendation: KEEP oldest by created_at, soft-delete the rest.
 *     EXCEPTION: if a duplicate has posted repayments while another does
 *     not, prefer keeping the one with repayments (avoid orphan journals).
 *
 * Run: npx tsx scripts/_oneshot/diag-duplicate-kreditur.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    /* Resolve outlet (assume single outlet — Mahakan). */
    const [out] = (
      await c.query(
        `SELECT id, name FROM outlets WHERE deleted_at IS NULL LIMIT 1`,
      )
    ).rows;
    if (!out) throw new Error("No outlet found");
    console.log(`Outlet: ${out.name} (${out.id})\n`);

    /* Find duplicate groups. */
    const dupes = (
      await c.query(
        `SELECT LOWER(TRIM(full_name)) AS norm_name, COUNT(*) AS cnt
         FROM creditors
         WHERE outlet_id = $1 AND deleted_at IS NULL
         GROUP BY LOWER(TRIM(full_name))
         HAVING COUNT(*) > 1
         ORDER BY cnt DESC, norm_name`,
        [out.id],
      )
    ).rows;

    if (dupes.length === 0) {
      console.log("✅ Tidak ada duplikat kreditur.");
      return;
    }

    console.log(`🔎 ${dupes.length} group(s) duplikat ditemukan:\n`);
    console.log("=".repeat(80));

    for (const d of dupes) {
      console.log(`\nGroup "${d.norm_name}" — ${d.cnt} entries`);
      console.log("-".repeat(80));

      const rows = (
        await c.query(
          `SELECT c.id, c.full_name, c.nik, c.phone, c.principal_original,
                  c.principal_outstanding, c.status, c.start_date,
                  c.created_at, c.created_by,
                  u.name AS created_by_name, u.email AS created_by_email,
                  (SELECT COUNT(*) FROM creditor_repayments cr
                    WHERE cr.creditor_id = c.id) AS repay_count,
                  (SELECT COUNT(*) FROM creditor_repayments cr
                    WHERE cr.creditor_id = c.id AND cr.status = 'posted'
                      AND cr.journal_entry_id IS NOT NULL) AS journal_count
           FROM creditors c
           LEFT JOIN users u ON u.id = c.created_by
           WHERE c.outlet_id = $1 AND c.deleted_at IS NULL
             AND LOWER(TRIM(c.full_name)) = $2
           ORDER BY c.created_at ASC`,
          [out.id, d.norm_name],
        )
      ).rows;

      let i = 0;
      for (const r of rows) {
        i++;
        const isOldest = i === 1;
        const hasJournal = Number(r.journal_count) > 0;
        const tag = hasJournal
          ? "🔒 HAS POSTED JOURNAL"
          : isOldest
            ? "⭐ OLDEST (default keep)"
            : "🗑  CANDIDATE DELETE";
        console.log(`  [${i}] ${tag}`);
        console.log(`      id: ${r.id}`);
        console.log(`      name: ${r.full_name}`);
        console.log(
          `      pokok awal: Rp ${Number(r.principal_original).toLocaleString("id-ID")}`,
        );
        console.log(
          `      outstanding: Rp ${Number(r.principal_outstanding).toLocaleString("id-ID")}`,
        );
        console.log(`      status: ${r.status}`);
        console.log(`      start: ${r.start_date}`);
        console.log(`      nik: ${r.nik ?? "-"} | phone: ${r.phone ?? "-"}`);
        console.log(
          `      created: ${new Date(r.created_at).toISOString().slice(0, 19)} by ${r.created_by_name ?? "-"} (${r.created_by_email ?? "-"})`,
        );
        console.log(
          `      repayments: ${r.repay_count} (${r.journal_count} posted with journal)`,
        );
      }

      /* Determine which to keep vs delete. */
      const withJournal = rows.filter((r) => Number(r.journal_count) > 0);
      let keepId: string;
      if (withJournal.length === 1) {
        keepId = withJournal[0].id;
        console.log(
          `\n  → KEEP id ${keepId} (has posted journal, cannot orphan accounting)`,
        );
      } else if (withJournal.length > 1) {
        keepId = withJournal[0].id;
        console.log(
          `\n  ⚠ Multiple entries have posted journals — manual review needed. Recommend keep oldest with journal: ${keepId}`,
        );
      } else {
        keepId = rows[0].id; // oldest
        console.log(`\n  → KEEP id ${keepId} (oldest, no repayments anywhere)`);
      }
      const deleteIds = rows.filter((r) => r.id !== keepId).map((r) => r.id);
      console.log(`  → DELETE: ${deleteIds.length} row(s)`);
      for (const did of deleteIds) console.log(`     • ${did}`);
    }

    console.log("\n" + "=".repeat(80));
    console.log("DRY-RUN done. Re-jalankan cleanup script untuk soft-delete.");
    console.log("=".repeat(80));
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
