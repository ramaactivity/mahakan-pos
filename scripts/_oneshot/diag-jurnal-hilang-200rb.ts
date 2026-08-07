/**
 * Sesi AE-191 — diagnosa: owner catat "jurnal transaksi lain-lain" Rp 200.000,
 * tersimpan, lalu hilang saat dicek ulang.
 *
 * Read-only. Menyisir semua kandidat sumber bernilai 200.000 hari ini.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const rows = (r: any) => ((r as any).rows ?? r) as any[];
  const show = (judul: string, data: any[]) => {
    console.log(`\n=== ${judul} (${data.length}) ===`);
    if (data.length) console.table(data);
  };

  // 1. Journal entries 2 hari terakhir bernilai 200rb (semua status).
  show(
    "JOURNAL ENTRIES nilai 200.000 (7 hari terakhir, semua status)",
    rows(
      await db.execute(sql`
        SELECT je.id, je.entry_number, je.entry_date, je.description, je.status,
               je.source_type, je.source_id, je.created_at, je.reverses_entry_id, je.reversed_by_entry_id,
               u.name AS dibuat_oleh,
               (SELECT sum(jl.debit) FROM journal_lines jl WHERE jl.entry_id = je.id) AS total_debit
        FROM journal_entries je
        LEFT JOIN users u ON u.id = je.created_by
        WHERE je.created_at > now() - interval '7 days'
          AND EXISTS (SELECT 1 FROM journal_lines jl
                      WHERE jl.entry_id = je.id AND (jl.debit = 200000 OR jl.credit = 200000))
        ORDER BY je.created_at DESC
      `),
    ),
  );

  // 2. Pemasukan (income) 200rb.
  show(
    "PEMASUKAN 200.000 (7 hari)",
    rows(
      await db.execute(sql`
        SELECT id, amount, description, income_date, created_at, deleted_at, payment_method
        FROM incomes
        WHERE amount = 200000 AND created_at > now() - interval '7 days'
        ORDER BY created_at DESC
      `),
    ),
  );

  // 3. Pengeluaran (expense) 200rb.
  show(
    "PENGELUARAN 200.000 (7 hari)",
    rows(
      await db.execute(sql`
        SELECT id, amount, description, expense_date, created_at, deleted_at, source_type
        FROM expenses
        WHERE amount = 200000 AND created_at > now() - interval '7 days'
        ORDER BY created_at DESC
      `),
    ),
  );

  // 4. Antrian retry jurnal — mungkin nyangkut di sini.
  show(
    "ANTRIAN RETRY JURNAL (7 hari)",
    rows(
      await db.execute(sql`
        SELECT id, source_type, source_id, hook_label, retry_count, left(last_error,120) AS last_error,
               created_at, resolved_at, abandoned_at
        FROM journal_retry_queue
        WHERE created_at > now() - interval '7 days'
        ORDER BY created_at DESC
        LIMIT 40
      `),
    ),
  );

  // 5. Audit log — jejak apa pun hari ini yang menyebut 200000.
  show(
    "AUDIT LOG hari ini yang menyebut 200000",
    rows(
      await db.execute(sql`
        SELECT id, event_type, entity_type, entity_id, user_id, created_at,
               left(payload::text, 300) AS payload
        FROM audit_logs
        WHERE created_at > now() - interval '2 days'
          AND payload::text LIKE '%200000%'
        ORDER BY created_at DESC
        LIMIT 40
      `),
    ),
  );

  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
