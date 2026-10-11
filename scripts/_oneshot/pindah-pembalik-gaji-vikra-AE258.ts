/**
 * Sesi AE-258 — pembalik "Gaji Vikra" 8 Agu (dobel, dibatalkan owner 11 Okt)
 * dipindah ke tanggal aslinya. Pola pair-void sama dengan reverseJournalEntry:
 * lawan bertanggal sama + sourceId null + metadata.reversesEntryId, kedua sisi
 * 'reversed'; lalu pembalik diposting ulang bertanggal 8 Agu.
 */
import { Pool } from "@neondatabase/serverless";
const APPLY = process.argv.includes("--apply");
const ENTRY = "JE-202610-0068";
const NEW_DATE = "2026-08-08";
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pool.query(s, p)).rows as T[];
  const [e] = await q<{ id: string; outlet_id: string; entry_date: string; source_type: string; source_id: string; status: string; description: string }>(
    `SELECT id, outlet_id, entry_date::text, source_type, source_id, status, description FROM journal_entries WHERE entry_number=$1`, [ENTRY]);
  const lines = await q<{ account_id: string; debit: string; credit: string; description: string | null; code: string }>(
    `SELECT l.account_id, l.debit, l.credit, l.description, a.code FROM journal_lines l JOIN chart_of_accounts a ON a.id=l.account_id WHERE l.entry_id=$1 ORDER BY l.line_number`, [e?.id]);
  const [dm] = await q<{ entry_date: string; description: string; status: string }>(
    `SELECT entry_date::text, description, status FROM daily_market_entries WHERE id=$1`, [e?.source_id]);
  console.log(e, dm, lines.map((l) => `${l.code} Dr ${l.debit} Cr ${l.credit}`));
  if (!e || e.status !== "posted" || e.source_type !== "daily_market_spend_reversal" || dm?.entry_date !== NEW_DATE || dm.status !== "reversed")
    throw new Error("Kondisi tidak sesuai — batal");
  if (!APPLY) return pool.end();

  const { recordJournal } = await import("@/features/accounting/posting");
  const [actor] = await q<{ id: string }>(`SELECT id FROM users WHERE email='rama.activity98@gmail.com'`);
  const reason = "Dipindah ke tanggal catatan aslinya (8 Agu) — AE-258";
  const counter = await recordJournal({
    outletId: e.outlet_id, entryDate: e.entry_date, description: `Pembatalan jurnal ${ENTRY} — ${reason}`,
    sourceType: "daily_market_spend_reversal", sourceId: null,
    lines: lines.map((l) => ({ accountId: l.account_id, debit: Number(l.credit), credit: Number(l.debit), description: `Dibatalkan: ${l.description ?? ""}` })),
    actorId: actor!.id, metadata: { reversesEntryId: e.id, reason },
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(`UPDATE journal_entries SET status='reversed', reversed_by_entry_id=$2, reverse_reason=$3, updated_at=now() WHERE id=$1 AND status='posted'`, [e.id, counter.entryId, reason]);
    if (r.rowCount !== 1) throw new Error("CAS gagal");
    await client.query(`UPDATE journal_entries SET status='reversed', reverses_entry_id=$1, updated_at=now() WHERE id=$2`, [e.id, counter.entryId]);
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
  const moved = await recordJournal({
    outletId: e.outlet_id, entryDate: NEW_DATE, description: e.description,
    sourceType: "daily_market_spend_reversal", sourceId: e.source_id,
    lines: lines.map((l) => ({ accountId: l.account_id, debit: Number(l.debit), credit: Number(l.credit), description: l.description ?? undefined })),
    status: "posted", actorId: actor!.id, metadata: { reversedEntryId: e.source_id, movedFrom: ENTRY, session: "AE-258" },
  });
  console.log("pembalik baru", moved.entryNumber);
  console.table(await q(`SELECT to_char(j.entry_date,'YYYY-MM') m, sum(l.debit-l.credit)::bigint net_kurir FROM journal_entries j JOIN journal_lines l ON l.entry_id=j.id JOIN chart_of_accounts a ON a.id=l.account_id WHERE j.status='posted' AND a.code='1103' GROUP BY 1 ORDER BY 1`));
  await pool.end();
}
main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
