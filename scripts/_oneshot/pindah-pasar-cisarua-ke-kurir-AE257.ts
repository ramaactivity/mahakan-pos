/**
 * Sesi AE-257 — nota Pasar Cisarua yang dibayar "Transfer BCA" dipindah
 * sumber bayarnya ke Saldo Kurir (1103), plus top up BCA → kurir sesuai
 * mutasi rekening yang sebenarnya.
 *
 * Kenapa bukan memindahkan notanya ke tabel Daily Market: laporan HPP/COGS,
 * Rekap Belanja, Masuk Bahan, dan tautan PR membaca Purchasing. Nota tetap di
 * Purchasing, yang berubah hanya AKUN KREDIT jurnalnya (1110 → 1103) — pola
 * pair-void + posting ulang yang sama dengan koreksi metode bayar AE-199/210.
 * Nilai posting ulang = BARIS jurnal lama, bukan dihitung ulang.
 *
 *   npm run oneshot scripts/_oneshot/pindah-pasar-cisarua-ke-kurir-AE257.ts -- \
 *     --from=2026-07-01 --to=2026-09-30 --topups=path/mutasi.csv [--courier=Vikra] \
 *     [--reverse-topup=<daily_market_entry_id>] [--apply]
 *
 * CSV top up: `tanggal,nominal[,keterangan]` per baris (YYYY-MM-DD, rupiah bulat).
 * Tanpa --apply: DRY-RUN — hanya mencetak rencana + saldo kurir berjalan.
 * Juni sengaja tidak disentuh: sebelum batas buku 1 Juli, saldo BCA per
 * tanggal itu sudah dikunci lewat Saldo Awal (AE-212).
 */
import { readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";

const arg = (k: string) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const APPLY = process.argv.includes("--apply");
const FROM = arg("from") ?? "2026-07-01";
const TO = arg("to") ?? "2026-09-30";
const COURIER = arg("courier") ?? "Vikra";
const TOPUP_CSV = arg("topups");
const REVERSE_TOPUP = arg("reverse-topup");
const SUPPLIER = "Pasar Cisarua";
const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

type Topup = { date: string; amount: number; note: string };
function readTopups(path: string): Topup[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^tanggal/i.test(l))
    .map((l, i) => {
      const [date, amount, ...note] = l.split(",");
      const n = Number(amount);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !Number.isInteger(n) || n <= 0) {
        throw new Error(`CSV baris ${i + 1} tidak valid: "${l}"`);
      }
      return { date: date!, amount: n, note: note.join(",").trim() };
    });
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) =>
    (await pool.query(s, p)).rows as T[];

  const [outlet] = await q<{ id: string }>(
    `SELECT id FROM outlets WHERE deleted_at IS NULL`,
  );
  const owners = await q<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE role='owner' AND deleted_at IS NULL ORDER BY created_at`,
  );
  const actorEmail = arg("actor");
  const actor = actorEmail ? owners.find((o) => o.email === actorEmail) : owners.length === 1 ? owners[0] : undefined;
  if (!actor) throw new Error(`Pilih owner dengan --actor=<email>: ${owners.map((o) => o.email).join(", ")}`);
  const [acc1103] = await q<{ id: string }>(`SELECT id FROM chart_of_accounts WHERE code='1103'`);
  const [acc1110] = await q<{ id: string }>(`SELECT id FROM chart_of_accounts WHERE code='1110'`);
  const [bca] = await q<{ id: string; bank_name: string; account_name: string; account_number: string | null }>(
    `SELECT id, bank_name, account_name, account_number FROM bank_accounts
     WHERE outlet_id=$1 AND is_active AND bank_name ILIKE '%bca%' ORDER BY created_at`,
    [outlet!.id],
  );
  if (!acc1103 || !acc1110 || !bca) throw new Error("Akun 1103/1110 atau rekening BCA tidak ditemukan");

  /* Target: nota Transfer BCA yang jurnal pembeliannya memang mengkredit 1110.
   * Nota yang jurnalnya sudah dibatalkan (tak ada kredit 1110) DILEWATI —
   * memindahkannya akan memotong saldo kurir untuk uang yang tak pernah
   * tercatat keluar dari BCA. */
  const targets = await q<{
    id: string; d: string; total: string; invoice_no: string | null;
    entry_id: string; source_id: string; bca_credit: string;
  }>(
    `SELECT p.id, p.purchase_date::text d, p.total_amount total, p.invoice_no,
            j.id entry_id, j.source_id, l.credit bca_credit
       FROM purchases p
       JOIN suppliers s ON s.id = p.supplier_id
       JOIN journal_entries j ON j.status='posted' AND j.source_type='purchase_create'
            AND (j.source_id = p.id OR j.source_id IN (SELECT g.id FROM goods_receipts g WHERE g.purchase_id = p.id))
       JOIN journal_lines l ON l.entry_id = j.id AND l.account_id = $4 AND l.credit > 0
      WHERE p.outlet_id = $1 AND s.name = $2 AND p.payment_method = 'transfer_bca'
        AND p.status <> 'cancelled' AND p.purchase_date BETWEEN $3::date AND $5::date
      ORDER BY p.purchase_date, p.created_at`,
    [outlet!.id, SUPPLIER, FROM, acc1110.id, TO],
  );
  const skipped = await q<{ id: string; d: string; total: string }>(
    `SELECT p.id, p.purchase_date::text d, p.total_amount total FROM purchases p JOIN suppliers s ON s.id=p.supplier_id
      WHERE p.outlet_id=$1 AND s.name=$2 AND p.payment_method='transfer_bca' AND p.status<>'cancelled'
        AND p.purchase_date BETWEEN $3::date AND $4::date AND NOT (p.id = ANY($5::uuid[]))`,
    [outlet!.id, SUPPLIER, FROM, TO, targets.map((t) => t.id)],
  );
  const purchaseIds = new Set(targets.map((t) => t.id));
  if (purchaseIds.size !== targets.length) {
    throw new Error("Ada nota dengan lebih dari satu jurnal pembelian (multi-GR) — tangani manual dulu");
  }

  const topups = TOPUP_CSV ? readTopups(TOPUP_CSV) : [];
  const rerouteTotal = targets.reduce((s, t) => s + Number(t.bca_credit), 0);
  const topupTotal = topups.reduce((s, t) => s + t.amount, 0);

  const existing = await q<{ id: string; kind: string; d: string; amount: string; description: string }>(
    `SELECT id, kind, entry_date::text d, amount, description FROM daily_market_entries
      WHERE outlet_id=$1 AND status='posted' AND deleted_at IS NULL ORDER BY entry_date, created_at`,
    [outlet!.id],
  );
  const reverseRow = REVERSE_TOPUP ? existing.find((e) => e.id === REVERSE_TOPUP && e.kind === "topup") : undefined;
  if (REVERSE_TOPUP && !reverseRow) throw new Error(`Top up ${REVERSE_TOPUP} tidak ditemukan / bukan top up aktif`);

  /* Saldo kurir berjalan per tanggal setelah migrasi — minus di suatu hari
   * artinya ada transfer yang belum masuk CSV (atau tanggalnya meleset). */
  const events: Array<{ d: string; delta: number; what: string }> = [
    ...existing
      .filter((e) => e.id !== reverseRow?.id)
      .map((e) => ({ d: e.d, delta: e.kind === "topup" ? Number(e.amount) : -Number(e.amount), what: `ada: ${e.kind} ${e.description}` })),
    ...topups.map((t) => ({ d: t.date, delta: t.amount, what: `TOP UP baru ${t.note}` })),
    ...targets.map((t) => ({ d: t.d, delta: -Number(t.bca_credit), what: `nota ${t.invoice_no ?? t.id.slice(0, 8)}` })),
  ].sort((a, b) => a.d.localeCompare(b.d) || b.delta - a.delta);
  let bal = 0;
  let minBal = 0;
  let minDate = "";
  const byMonth = new Map<string, { reroute: number; topup: number; n: number }>();
  for (const e of events) {
    bal += e.delta;
    if (bal < minBal) { minBal = bal; minDate = e.d; }
  }
  for (const t of targets) {
    const m = byMonth.get(t.d.slice(0, 7)) ?? { reroute: 0, topup: 0, n: 0 };
    m.reroute += Number(t.bca_credit); m.n++; byMonth.set(t.d.slice(0, 7), m);
  }
  /* Top up yang sudah diinput owner lewat layar Daily Market ikut dihitung
   * per bulan — bukan hanya yang dari CSV. */
  const topupsInRange = [
    ...topups.map((t) => ({ d: t.date, amount: t.amount })),
    ...existing
      .filter((e) => e.kind === "topup" && e.id !== reverseRow?.id && e.d >= FROM && e.d <= TO)
      .map((e) => ({ d: e.d, amount: Number(e.amount) })),
  ];
  for (const t of topupsInRange) {
    const m = byMonth.get(t.d.slice(0, 7)) ?? { reroute: 0, topup: 0, n: 0 };
    m.topup += t.amount; byMonth.set(t.d.slice(0, 7), m);
  }

  console.log(`\n=== ${APPLY ? "APPLY" : "DRY-RUN"} — ${SUPPLIER} ${FROM}..${TO}, kurir ${COURIER}, aktor ${actor.email} ===`);
  console.log(`Nota dipindah ke Saldo Kurir : ${targets.length} nota, ${rp(rerouteTotal)}`);
  console.log(`Nota DILEWATI (tanpa kredit BCA): ${skipped.length} ${skipped.map((s) => `${s.d} ${rp(Number(s.total))}`).join("; ")}`);
  console.log(`Top up baru dari CSV          : ${topups.length} transfer, ${rp(topupTotal)}`);
  if (reverseRow) console.log(`Top up lama DIBATALKAN        : ${reverseRow.d} ${rp(Number(reverseRow.amount))} "${reverseRow.description}"`);
  console.table(Object.fromEntries([...byMonth].sort().map(([m, v]) => [m, { nota: v.n, "keluar dari saldo kurir": v.reroute, "top up": v.topup, selisih: v.topup - v.reroute }])));
  console.log(`Efek ke saldo BCA (1110)      : ${rerouteTotal - topupTotal + (reverseRow ? Number(reverseRow.amount) : 0) >= 0 ? "+" : ""}${rp(rerouteTotal - topupTotal + (reverseRow ? Number(reverseRow.amount) : 0))}`);
  console.log(`Saldo kurir akhir (1103)      : ${rp(bal)}`);
  console.log(minBal < 0 ? `⚠️  Saldo kurir sempat MINUS ${rp(minBal)} pada ${minDate} — cek CSV mutasi.` : "Saldo kurir tidak pernah minus ✅");
  if (!topupsInRange.length) console.log("⚠️  Belum ada top up di rentang ini: saldo BCA belum benar, transfer ke kurir wajib dicatat juga.");

  if (!APPLY) { await pool.end(); return; }
  if (minBal < 0) throw new Error("Batal: saldo kurir akan minus. Lengkapi CSV top up dulu.");

  const { pairVoidJournalForSource } = await import("@/features/accounting/journal-void");
  const { recordJournal } = await import("@/features/accounting/posting");
  const { insertDailyMarketTopup } = await import("@/features/daily-market/topup-core");
  const { reverseDailyMarketLines, mapDailyMarketTopup } = await import("@/features/accounting/mapping/dailyMarket");
  const { logAudit } = await import("@/lib/audit/logger");
  const reason = "Dibayar dari saldo kurir Daily Market, bukan langsung dari BCA (sesi AE-257)";

  // 1) Top up dulu, supaya saldo kurir sudah ada sebelum nota memakainya.
  for (const t of topups) {
    const r = await insertDailyMarketTopup({
      outletId: outlet!.id, actorId: actor.id,
      bank: { id: bca.id, bankName: bca.bank_name, accountName: bca.account_name, accountNumber: bca.account_number },
      amount: t.amount, courierName: COURIER, entryDate: t.date,
      description: t.note || `Top up belanja pasar ${t.date} (migrasi AE-257)`, receiptImageUrl: null,
    });
    console.log(`top up ${t.date} ${rp(t.amount)} → ${r.journalEntryId}`);
  }

  // 2) Nota: balik jurnal lama, posting ulang dengan kredit 1103.
  for (const t of targets) {
    const [entry] = await q<{ entry_date: string; description: string }>(
      `SELECT entry_date::text, description FROM journal_entries WHERE id=$1`, [t.entry_id]);
    const lines = await q<{ account_id: string; debit: string; credit: string; description: string | null }>(
      `SELECT account_id, debit, credit, description FROM journal_lines WHERE entry_id=$1 ORDER BY line_number`, [t.entry_id]);
    const toLines = (swap: boolean) => lines.map((l) => ({
      accountId: swap && l.account_id === acc1110.id ? acc1103.id : l.account_id,
      debit: Number(l.debit), credit: Number(l.credit),
      description: swap && l.account_id === acc1110.id ? `${l.description ?? ""} — dari saldo kurir ${COURIER}` : (l.description ?? undefined),
    }));
    await pairVoidJournalForSource({
      outletId: outlet!.id, sourceType: "purchase_create", voidSourceType: "purchase_create_void",
      sourceId: t.source_id, actorId: actor.id, reason,
    });
    try {
      await recordJournal({
        outletId: outlet!.id, entryDate: entry!.entry_date, description: entry!.description,
        sourceType: "purchase_create", sourceId: t.source_id, lines: toLines(true), actorId: actor.id,
        metadata: { reroutedFrom: "1110", session: "AE-257" },
      });
    } catch (e) {
      /* Posting ulang gagal → kembalikan jurnal aslinya supaya nota tidak
       * tertinggal tanpa jurnal sama sekali. */
      await recordJournal({
        outletId: outlet!.id, entryDate: entry!.entry_date, description: entry!.description,
        sourceType: "purchase_create", sourceId: t.source_id, lines: toLines(false), actorId: actor.id,
      });
      throw e;
    }
    await pool.query(
      `UPDATE purchases SET payment_method='courier', updated_at=now(), updated_by=$2 WHERE id=$1`, [t.id, actor.id]);
    await pool.query(
      `UPDATE expenses SET payment_method='other', updated_at=now(), updated_by=$2
        WHERE id IN (SELECT expense_id FROM purchases WHERE id=$1 UNION SELECT expense_id FROM goods_receipts WHERE purchase_id=$1)`,
      [t.id, actor.id]);
    await logAudit({
      eventType: "purchase.payment_method_update", userId: actor.id, entityType: "purchase", entityId: t.id,
      payload: { summary: `Sumber bayar Transfer BCA → Saldo Kurir (${COURIER}) — ${reason}`, context: { amount: Number(t.bca_credit) } },
      metadata: { outletId: outlet!.id, actorRole: "owner" },
    });
    console.log(`nota ${t.d} ${rp(Number(t.bca_credit))} → kurir`);
  }

  // 3) Top up lama yang sudah terwakili CSV (mis. "Sisa top up september").
  if (reverseRow) {
    const [row] = await q<{ amount: string; courier_name: string | null }>(
      `SELECT amount, courier_name FROM daily_market_entries WHERE id=$1`, [reverseRow.id]);
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const j = await recordJournal({
      outletId: outlet!.id, entryDate: today,
      description: `Pembalik top up daily market — sudah terwakili top up migrasi AE-257`,
      sourceType: "daily_market_topup_reversal", sourceId: reverseRow.id,
      lines: reverseDailyMarketLines(mapDailyMarketTopup({
        amount: Number(row!.amount), bankAccountCode: "1110",
        bankLabel: bca.bank_name, courierName: row!.courier_name ?? COURIER,
      })),
      status: "posted", actorId: actor.id, metadata: { reversedEntryId: reverseRow.id, session: "AE-257" },
    });
    await pool.query(
      `UPDATE daily_market_entries SET status='reversed', reversed_at=now(), reversed_by=$2, reversal_reason=$3, updated_at=now() WHERE id=$1`,
      [reverseRow.id, actor.id, "Sudah terwakili top up migrasi AE-257"]);
    console.log(`top up lama dibatalkan → ${j.entryId}`);
  }

  // 4) Cek silang: saldo layar Daily Market = saldo 1103 di buku besar.
  const [gl] = await q<{ bal: string }>(
    `SELECT coalesce(sum(l.debit-l.credit),0) bal FROM journal_lines l JOIN journal_entries j ON j.id=l.entry_id
      WHERE j.status='posted' AND l.account_id=$1`, [acc1103.id]);
  const [screen] = await q<{ bal: string }>(
    `SELECT (SELECT coalesce(sum(CASE WHEN kind='topup' THEN amount ELSE -amount END),0) FROM daily_market_entries
              WHERE outlet_id=$1 AND status='posted' AND deleted_at IS NULL)
          - (SELECT coalesce(sum(total_amount),0) FROM purchases
              WHERE outlet_id=$1 AND payment_method='courier' AND status<>'cancelled') bal`, [outlet!.id]);
  console.log(`Saldo 1103 buku besar ${rp(Number(gl!.bal))} vs layar Daily Market ${rp(Number(screen!.bal))} ${Number(gl!.bal) === Number(screen!.bal) ? "✅" : "❌ BEDA"}`);
  await pool.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
