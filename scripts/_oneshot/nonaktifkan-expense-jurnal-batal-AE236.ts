/**
 * Sesi AE-236 — tambal data: pengeluaran/pemasukan yang jurnal *_create-nya
 * sudah dibatalkan lewat "Batalkan Jurnal" (tanpa jurnal pengganti) tapi
 * barisnya masih hidup → soft-delete + audit log per baris.
 *
 * Sejak AE-236 reverseJournalEntry melakukan ini sendiri; skrip ini untuk
 * baris yang dibatalkan sebelumnya (prod 30 Sep 2026: 22 expense, Rp 1,09jt).
 * Soft delete — balik dengan `UPDATE expenses SET deleted_at=NULL WHERE id=…`
 * (daftar id ada di payload audit `expense.soft_delete_journal_reversed`).
 *
 * Jalankan: npx tsx --env-file=.env.local scripts/_oneshot/nonaktifkan-expense-jurnal-batal-AE236.ts [--apply]
 */
import { Pool } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [table, dateCol, src, event] of [
      ["expenses", "expense_date", "expense_create", "expense.soft_delete_journal_reversed"],
      ["incomes", "income_date", "income_create", "income.soft_delete_journal_reversed"],
    ] as const) {
      const { rows } = await client.query(
        `UPDATE ${table} t SET deleted_at = now(), updated_at = now()
          WHERE t.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = $1 AND je.source_id = t.id AND je.status = 'reversed')
            AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = $1 AND je.source_id = t.id AND je.status <> 'reversed')
          RETURNING t.id, t.outlet_id, t.${dateCol}::text AS d, t.description, t.amount`,
        [src],
      );
      for (const r of rows) {
        console.log(`${table}  ${r.d}  Rp ${Number(r.amount).toLocaleString("id-ID").padStart(9)}  ${r.description}`);
        await client.query(
          `INSERT INTO audit_logs (event_type, entity_type, entity_id, payload, metadata)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            event,
            table === "expenses" ? "expense" : "income",
            r.id,
            JSON.stringify({
              summary: `Dinonaktifkan: jurnal ${src} sudah dibatalkan — ${r.description} Rp ${r.amount}`,
              context: { date: r.d, amount: Number(r.amount), session: "AE-236" },
            }),
            JSON.stringify({ outletId: r.outlet_id, source: "script" }),
          ],
        );
      }
      const total = rows.reduce((s, r) => s + Number(r.amount), 0);
      console.log(`== ${table}: ${rows.length} baris, Rp ${total.toLocaleString("id-ID")}`);
    }
    await client.query(APPLY ? "COMMIT" : "ROLLBACK");
    console.log(APPLY ? "APPLIED" : "DRY RUN (rollback) — tambah --apply untuk menyimpan");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
main();
