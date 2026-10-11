/**
 * Sesi AE-258 — top up gelondongan Agustus/September diganti top up PER
 * TRANSFER sesuai mutasi BCA (backup "Mahakan Finance — Kas Besar"), supaya
 * saldo kurir per baris di layar Daily Market bisa dicocokkan hari per hari.
 *
 * - Top up lama (1 Agu Rp 4.332.000, 1 Sep Rp 2.851.000) dibalik bertanggal
 *   aslinya — bukan transfer nyata, jadi dihapus seolah tak pernah ada.
 * - Rp 32.000 = saldo yang sudah dipegang kurir per 1 Agustus (sisa transfer
 *   Juli). Dicatat 31 Jul supaya mutasi BCA Agustus pas Rp 4.300.000.
 * - Top up baru dimasukkan DULU, pembalik belakangan: saldo 1103 tidak pernah
 *   minus di tengah jalan.
 *
 *   npm run oneshot scripts/_oneshot/ganti-topup-gelondongan-AE258.ts [-- --apply]
 */
import { Pool } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const COURIER = "Vikra";
const OLD = [
  { date: "2026-08-01", amount: 4_332_000 },
  { date: "2026-09-01", amount: 2_851_000 },
];
const NEW: Array<[string, number, string]> = [
  ["2026-07-31", 32_000, "Saldo awal kurir per 1 Agustus (sisa transfer Juli)"],
  ...([
    [2, 400_000], [5, 300_000], [8, 450_000], [10, 300_000], [12, 350_000],
    [15, 300_000], [17, 450_000], [18, 100_000], [20, 200_000], [23, 500_000],
    [25, 200_000], [27, 250_000], [29, 250_000], [30, 250_000],
  ] as const).map(([d, a]): [string, number, string] => [`2026-08-${String(d).padStart(2, "0")}`, a, "TF Vikra"]),
  ...([
    [2, 600_000], [5, 200_000], [9, 300_000], [12, 451_000], [15, 250_000],
    [19, 250_000], [22, 200_000], [24, 250_000], [26, 200_000], [28, 150_000],
  ] as const).map(([d, a]): [string, number, string] => [`2026-09-${String(d).padStart(2, "0")}`, a, "TF Vikra"]),
];
const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) =>
    (await pool.query(s, p)).rows as T[];

  const [outlet] = await q<{ id: string }>(`SELECT id FROM outlets WHERE deleted_at IS NULL`);
  const [actor] = await q<{ id: string }>(`SELECT id FROM users WHERE email='rama.activity98@gmail.com'`);
  const old = [];
  for (const o of OLD) {
    const rows = await q<{ id: string; bank_account_id: string; journal_entry_id: string }>(
      `SELECT id, bank_account_id, journal_entry_id FROM daily_market_entries
        WHERE outlet_id=$1 AND kind='topup' AND status='posted' AND deleted_at IS NULL AND entry_date=$2 AND amount=$3`,
      [outlet!.id, o.date, o.amount]);
    if (rows.length !== 1) throw new Error(`Top up ${o.date} ${rp(o.amount)}: ketemu ${rows.length}, harus 1`);
    old.push({ ...o, ...rows[0]! });
  }
  if (old[0]!.bank_account_id !== old[1]!.bank_account_id) throw new Error("Rekening dua top up lama beda");
  const [bank] = await q<{ id: string; bank_name: string; account_name: string; account_number: string | null }>(
    `SELECT id, bank_name, account_name, account_number FROM bank_accounts WHERE id=$1`, [old[0]!.bank_account_id]);

  /* Saldo kurir berjalan per hari SESUDAH penggantian. */
  const events = [
    ...(await q<{ d: string; delta: string }>(
      `SELECT entry_date::text d, CASE WHEN kind='topup' THEN amount ELSE -amount END delta FROM daily_market_entries
        WHERE outlet_id=$1 AND status='posted' AND deleted_at IS NULL AND NOT (id = ANY($2::uuid[]))`,
      [outlet!.id, old.map((o) => o.id)])),
    ...(await q<{ d: string; delta: string }>(
      `SELECT purchase_date::text d, -total_amount delta FROM purchases WHERE outlet_id=$1 AND payment_method='courier' AND status<>'cancelled'`,
      [outlet!.id])),
    ...NEW.map(([d, a]) => ({ d, delta: String(a) })),
  ].map((e) => ({ d: e.d, delta: Number(e.delta) }));
  const byDay = new Map<string, number>();
  for (const e of events) byDay.set(e.d, (byDay.get(e.d) ?? 0) + e.delta);
  let bal = 0;
  let min = { bal: 0, d: "" };
  const endOf: Record<string, number> = {};
  for (const d of [...byDay.keys()].sort()) {
    bal += byDay.get(d)!;
    if (bal < min.bal) min = { bal, d };
    endOf[d.slice(0, 7)] = bal;
  }

  const sumMonth = (m: string) => NEW.filter(([d]) => d.startsWith(m)).reduce((s, [, a]) => s + a, 0);
  console.log(`\n=== ${APPLY ? "APPLY" : "DRY-RUN"} — rekening ${bank!.bank_name} ${bank!.account_name} ===`);
  console.log(`Dibatalkan: ${old.map((o) => `${o.date} ${rp(o.amount)}`).join(", ")}`);
  console.log(`Top up baru: ${NEW.length} catatan — Jul ${rp(sumMonth("2026-07"))}, Agu ${rp(sumMonth("2026-08"))}, Sep ${rp(sumMonth("2026-09"))}`);
  console.log(`Saldo kurir akhir bulan:`, Object.fromEntries(Object.entries(endOf).map(([m, b]) => [m, rp(b)])));
  console.log(`Saldo kurir sekarang: ${rp(bal)}`);
  console.log(min.bal < 0 ? `❌ Sempat MINUS ${rp(min.bal)} pada ${min.d}` : "Saldo kurir tidak pernah minus di hari mana pun ✅");
  if (!APPLY) return pool.end();
  if (min.bal < 0) throw new Error("Batal: saldo kurir akan minus");

  const { insertDailyMarketTopup, bankLabelOf } = await import("@/features/daily-market/topup-core");
  const { recordJournal } = await import("@/features/accounting/posting");
  const { mapDailyMarketTopup, reverseDailyMarketLines } = await import("@/features/accounting/mapping/dailyMarket");
  const { resolveBankCodeFromBankName } = await import("@/features/accounting/mapping/dividendWithdrawal");
  const bankArg = { id: bank!.id, bankName: bank!.bank_name, accountName: bank!.account_name, accountNumber: bank!.account_number };

  for (const [d, a, desc] of NEW) {
    await insertDailyMarketTopup({
      outletId: outlet!.id, actorId: actor!.id, bank: bankArg, amount: a, courierName: COURIER,
      entryDate: d, description: desc, receiptImageUrls: null,
    });
  }
  console.log(`${NEW.length} top up baru tercatat`);

  const reason = "Diganti top up per transfer sesuai mutasi BCA (AE-258)";
  for (const o of old) {
    await recordJournal({
      outletId: outlet!.id, entryDate: o.date,
      description: `Pembalik top up daily market — ${reason}`,
      sourceType: "daily_market_topup_reversal", sourceId: o.id,
      lines: reverseDailyMarketLines(mapDailyMarketTopup({
        amount: o.amount, bankAccountCode: resolveBankCodeFromBankName(bank!.bank_name),
        bankLabel: bankLabelOf(bankArg), courierName: COURIER,
      })),
      status: "posted", actorId: actor!.id, metadata: { reversedEntryId: o.id, session: "AE-258" },
    });
    await pool.query(
      `UPDATE daily_market_entries SET status='reversed', reversed_at=now(), reversed_by=$2, reversal_reason=$3, updated_at=now() WHERE id=$1 AND status='posted'`,
      [o.id, actor!.id, reason]);
    console.log(`dibatalkan ${o.date} ${rp(o.amount)}`);
  }

  const [gl] = await q<{ b: string }>(
    `SELECT coalesce(sum(l.debit-l.credit),0) b FROM journal_entries j JOIN journal_lines l ON l.entry_id=j.id
       JOIN chart_of_accounts a ON a.id=l.account_id WHERE j.status='posted' AND a.code='1103'`);
  const [screen] = await q<{ b: string }>(
    `SELECT (SELECT coalesce(sum(CASE WHEN kind='topup' THEN amount ELSE -amount END),0) FROM daily_market_entries WHERE outlet_id=$1 AND status='posted' AND deleted_at IS NULL)
          - (SELECT coalesce(sum(total_amount),0) FROM purchases WHERE outlet_id=$1 AND payment_method='courier' AND status<>'cancelled') b`,
    [outlet!.id]);
  console.log(`Saldo 1103 buku besar ${rp(Number(gl!.b))} vs layar ${rp(Number(screen!.b))} ${gl!.b === screen!.b ? "✅" : "❌ BEDA"}`);
  await pool.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
