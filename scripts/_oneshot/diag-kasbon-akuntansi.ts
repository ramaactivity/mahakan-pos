/**
 * READ-ONLY (sesi AE-209). Pertanyaan yang harus dijawab sebelum bikin
 * fitur cicilan kasbon: uang kasbon yang keluar itu MASUK pembukuan atau
 * tidak? Jawabannya menentukan lawan jurnal cicilan:
 *   - kalau kasbon keluar dicatat sebagai Pengeluaran → cicilan boleh
 *     Dr Kas / Cr 6105 (offset beban).
 *   - kalau tidak dicatat sama sekali → cicilan TIDAK boleh nambah kas GL
 *     (nanti kas GL ketinggian), cukup jadi catatan + potong gaji.
 *
 * Run: npx tsx --env-file-if-exists=.env.local scripts/_oneshot/diag-kasbon-akuntansi.ts
 */
import { Pool } from "@neondatabase/serverless";

const rupiah = (n: number) => n.toLocaleString("id-ID");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = async (text: string, params: unknown[] = []) =>
    (await pool.query(text, params)).rows as Record<string, unknown>[];

  const advances = await q(
    `SELECT a.status, COUNT(*)::int AS n, COALESCE(SUM(a.amount),0)::bigint AS total
       FROM employee_advances a
      GROUP BY a.status ORDER BY a.status`,
  );
  console.log("\n=== employee_advances per status ===");
  if (advances.length === 0) console.log("(kosong — belum ada kasbon)");
  for (const r of advances) {
    console.log(`${r.status}: ${r.n} row, Rp ${rupiah(Number(r.total))}`);
  }

  const rows = await q(
    `SELECT a.id, a.amount, a.issued_date, a.status, e.full_name
       FROM employee_advances a
       JOIN employees e ON e.id = a.employee_id
      ORDER BY a.issued_date DESC LIMIT 20`,
  );
  console.log("\n=== 20 kasbon terbaru ===");
  for (const r of rows) {
    console.log(
      `${r.issued_date} ${String(r.full_name).padEnd(24)} Rp ${rupiah(Number(r.amount)).padStart(12)}  ${r.status}`,
    );
  }

  console.log("\n=== apakah ada Pengeluaran yang nyebut kasbon? ===");
  const exp = await q(
    `SELECT x.expense_date, x.description, x.amount, x.payment_method,
            c.name AS category
       FROM expenses x
       LEFT JOIN expense_categories c ON c.id = x.category_id
      WHERE x.deleted_at IS NULL
        AND (x.description ILIKE '%kasbon%' OR c.name ILIKE '%kasbon%'
             OR x.description ILIKE '%pinjam%' OR c.name ILIKE '%pinjam%')
      ORDER BY x.expense_date DESC LIMIT 25`,
  );
  if (exp.length === 0) console.log("(tidak ada)");
  for (const r of exp) {
    console.log(
      `${r.expense_date} [${r.category ?? "-"}] ${r.description} — Rp ${rupiah(Number(r.amount))} (${r.payment_method})`,
    );
  }

  console.log("\n=== kategori pengeluaran yang ada (buat lihat konvensi) ===");
  const cats = await q(
    `SELECT c.name, COUNT(x.id)::int AS n
       FROM expense_categories c
       LEFT JOIN expenses x ON x.category_id = c.id AND x.deleted_at IS NULL
      GROUP BY c.name ORDER BY n DESC LIMIT 30`,
  );
  for (const r of cats) console.log(`${String(r.name).padEnd(32)} ${r.n}`);

  console.log("\n=== jurnal yang menyentuh 6105 Potongan Karyawan ===");
  const j = await q(
    `SELECT je.entry_date, je.source_type, je.description,
            l.debit, l.credit
       FROM journal_lines l
       JOIN journal_entries je ON je.id = l.entry_id
       JOIN chart_of_accounts a ON a.id = l.account_id
      WHERE a.code = '6105' AND je.status = 'posted'
      ORDER BY je.entry_date DESC LIMIT 20`,
  );
  if (j.length === 0) console.log("(belum pernah kepakai)");
  for (const r of j) {
    console.log(
      `${r.entry_date} ${r.source_type} Dr ${rupiah(Number(r.debit))} Cr ${rupiah(Number(r.credit))} — ${r.description}`,
    );
  }

  console.log("\n=== payroll_lines dengan advance_deduction > 0 ===");
  const pl = await q(
    `SELECT p.label, COUNT(*)::int AS n,
            COALESCE(SUM(l.advance_deduction),0)::bigint AS total, p.status
       FROM payroll_lines l
       JOIN payroll_periods p ON p.id = l.period_id
      WHERE l.advance_deduction > 0
      GROUP BY p.label, p.status ORDER BY p.label DESC LIMIT 15`,
  );
  if (pl.length === 0) console.log("(belum ada potongan kasbon di payroll)");
  for (const r of pl) {
    console.log(
      `${r.label} (${r.status}): ${r.n} karyawan, Rp ${rupiah(Number(r.total))}`,
    );
  }

  await pool.end();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
