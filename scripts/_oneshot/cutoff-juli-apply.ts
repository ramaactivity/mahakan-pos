/**
 * Sesi AE-207 — CUTOFF "MULAI BERSIH DARI JULI".
 *
 * Arahan owner (Rama): pencatatan mau rapih mulai Juli. Data lama
 * DISEMBUNYIKAN, BUKAN DIHAPUS. Script ini melakukan dua hal saja:
 *
 *   1. POST satu jurnal "Saldo Awal 1 Juli 2026" — ringkasan posisi keuangan
 *      per 30 Juni (kas, bank, piutang, persediaan, hutang, modal). Laba/rugi
 *      Maret–Juni tidak dibawa per akun, tapi mengendap di 3301 Saldo Laba
 *      Ditahan, persis seperti tutup buku yang benar.
 *   2. NYALAKAN batas buku di `outlets.settings.booksCutoff` → semua halaman
 *      (Jurnal, Neraca, Laba Rugi, Buku Besar, Pembelian, Kas, PR, Opname,
 *      pergerakan stok) mulai dari 1 Juli.
 *
 * TIDAK ADA satu baris pun yang di-DELETE. Bisa dibalik: `--undo` mencabut
 * jurnal saldo awal (status 'reversed') dan mengosongkan setelan cutoff.
 *
 * Keputusan owner yang dikodekan di sini:
 *   - Persediaan Bahan Pendukung (1142) yang MINUS di-nol-kan (owner: "minus
 *     diabaikan / di-nol-kan"). Selisihnya masuk laba ditahan.
 *   - Angka lain dipakai apa adanya dari GL, "nanti bisa di-adjust jurnal
 *     berapa riilnya" → koreksi belakangan lewat Jurnal Manual biasa.
 *   - Opname 30 Juni TETAP TAMPIL (jadi stok awal Juli) → batas opname 1 Juni.
 *
 * Usage:
 *   npx tsx scripts/_oneshot/cutoff-juli-apply.ts             → DRY-RUN
 *   npx tsx scripts/_oneshot/cutoff-juli-apply.ts --confirm    → eksekusi
 *   npx tsx scripts/_oneshot/cutoff-juli-apply.ts --undo --confirm → batalkan
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool, type PoolClient } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL tidak ada di .env.local");
  process.exit(1);
}

/** Batas buku. Jurnal saldo awal bertanggal SAMA dengan batas ini supaya
 *  ikut terhitung oleh filter `entry_date >= cutoff` (tanpa perkecualian). */
const CUTOFF = "2026-07-01";
/** Batas opname sengaja lebih tua: sesi 30 Juni = stok awal Juli. */
const OPNAME_CUTOFF = "2026-06-01";
/** Akun persediaan yang saldo minusnya di-nol-kan atas arahan owner. */
const ZERO_IF_NEGATIVE = new Set(["1140", "1141", "1142"]);
/** Akun penampung laba/rugi periode lama + selisih pembulatan. */
const RETAINED_CODE = "3301";

const confirmed = process.argv.includes("--confirm");
const undo = process.argv.includes("--undo");

const rp = (n: number) =>
  (n < 0 ? "-" : "") + "Rp " + Math.abs(Math.round(n)).toLocaleString("id-ID");

type AccRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  net: number; // debit - credit (signed)
};

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  console.log("═".repeat(70));
  console.log(
    `CUTOFF JULI — ${undo ? "↩️  UNDO" : "batas buku " + CUTOFF} · mode: ${
      confirmed ? "🔥 EKSEKUSI" : "🔍 DRY-RUN"
    }`,
  );
  console.log("═".repeat(70));

  const outletRes = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM outlets WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`,
  );
  const outlet = outletRes.rows[0];
  if (!outlet) throw new Error("Outlet tidak ditemukan");
  console.log(`Outlet: ${outlet.name} (${outlet.id})\n`);

  if (undo) {
    await runUndo(client, outlet.id);
    client.release();
    await pool.end();
    return;
  }

  /* ── Sudah pernah dijalankan? ───────────────────────────────────────── */
  const existing = await client.query<{ entry_number: string }>(
    `SELECT entry_number FROM journal_entries
     WHERE outlet_id = $1 AND source_type = 'opening_balance' AND status <> 'reversed'`,
    [outlet.id],
  );
  if (existing.rows.length > 0) {
    console.error(
      `❌ Jurnal Saldo Awal sudah ada (${existing.rows
        .map((r) => r.entry_number)
        .join(", ")}). Jalankan --undo dulu kalau mau ganti.`,
    );
    client.release();
    await pool.end();
    process.exit(1);
  }

  /* ── 1. Posisi GL per 30 Juni ───────────────────────────────────────── */
  const balRes = await client.query<{
    id: string;
    code: string;
    name: string;
    type: string;
    net: string;
  }>(
    `SELECT coa.id, coa.code, coa.name, coa.type,
            (SUM(jl.debit) - SUM(jl.credit))::text AS net
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.entry_id
     JOIN chart_of_accounts coa ON coa.id = jl.account_id
     WHERE je.outlet_id = $1 AND je.status = 'posted' AND je.entry_date < $2
     GROUP BY coa.id, coa.code, coa.name, coa.type
     HAVING (SUM(jl.debit) - SUM(jl.credit)) <> 0
     ORDER BY coa.code`,
    [outlet.id, CUTOFF],
  );
  const all: AccRow[] = balRes.rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    net: Math.round(Number(r.net)),
  }));

  // Trial balance lama HARUS seimbang; kalau tidak, ada jurnal rusak.
  const grandNet = all.reduce((s, a) => s + a.net, 0);
  if (grandNet !== 0) {
    console.error(
      `❌ ABORT — buku sebelum ${CUTOFF} tidak seimbang (selisih ${rp(grandNet)}).\n` +
        `   Betulkan jurnal yang rusak dulu; saldo awal yang dihitung dari buku\n` +
        `   yang tidak seimbang akan salah.`,
    );
    client.release();
    await pool.end();
    process.exit(1);
  }

  const isBalanceSheet = (t: string) =>
    t === "asset" || t === "liability" || t === "equity";

  /* Akun neraca dibawa; akun laba-rugi (revenue/cogs/expense) TIDAK — hasil
   * usaha Maret–Juni otomatis mengendap di 3301 lewat selisih plug. */
  const carried: AccRow[] = [];
  const pnl: AccRow[] = [];
  const zeroed: Array<{ code: string; name: string; was: number }> = [];

  for (const a of all) {
    if (!isBalanceSheet(a.type)) {
      pnl.push(a);
      continue;
    }
    if (a.code === RETAINED_CODE) continue; // jadi plug, jangan dobel
    if (ZERO_IF_NEGATIVE.has(a.code) && a.net < 0) {
      zeroed.push({ code: a.code, name: a.name, was: a.net });
      continue; // di-nol-kan → tidak dibawa
    }
    carried.push(a);
  }

  const retained = all.find((a) => a.code === RETAINED_CODE);
  const retainedAcc =
    retained ??
    (
      await client.query<{ id: string; code: string; name: string; type: string }>(
        `SELECT id, code, name, type FROM chart_of_accounts
         WHERE outlet_id = $1 AND code = $2 AND deleted_at IS NULL LIMIT 1`,
        [outlet.id, RETAINED_CODE],
      )
    ).rows.map((r) => ({ ...r, net: 0 }))[0];
  if (!retainedAcc) {
    throw new Error(`Akun ${RETAINED_CODE} (Saldo Laba Ditahan) tidak ada di COA`);
  }

  /* Plug = kebalikan dari total akun yang dibawa, supaya entry seimbang.
   * Isinya = laba/rugi periode lama + saldo laba ditahan lama + koreksi
   * persediaan minus yang di-nol-kan. */
  const carriedNet = carried.reduce((s, a) => s + a.net, 0);
  const plug = -carriedNet;

  type Line = { accountId: string; code: string; name: string; debit: number; credit: number };
  const lines: Line[] = carried.map((a) => ({
    accountId: a.id,
    code: a.code,
    name: a.name,
    debit: a.net > 0 ? a.net : 0,
    credit: a.net < 0 ? -a.net : 0,
  }));
  if (plug !== 0) {
    lines.push({
      accountId: retainedAcc.id,
      code: retainedAcc.code,
      name: retainedAcc.name,
      debit: plug > 0 ? plug : 0,
      credit: plug < 0 ? -plug : 0,
    });
  }

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

  /* ── Laporan ────────────────────────────────────────────────────────── */
  console.log(`JURNAL SALDO AWAL ${CUTOFF} — ${lines.length} baris\n`);
  console.log("  Kode  Akun                                        Debit           Kredit");
  console.log("  " + "─".repeat(76));
  for (const l of lines) {
    console.log(
      `  ${l.code.padEnd(6)}${l.name.slice(0, 40).padEnd(42)}${(l.debit ? rp(l.debit) : "").padStart(14)}  ${(l.credit ? rp(l.credit) : "").padStart(14)}`,
    );
  }
  console.log("  " + "─".repeat(76));
  console.log(
    `  ${"TOTAL".padEnd(48)}${rp(totalDebit).padStart(14)}  ${rp(totalCredit).padStart(14)}`,
  );
  console.log(
    totalDebit === totalCredit
      ? "  ✅ Seimbang\n"
      : `  ❌ TIDAK SEIMBANG (selisih ${rp(totalDebit - totalCredit)})\n`,
  );
  if (totalDebit !== totalCredit) {
    client.release();
    await pool.end();
    process.exit(1);
  }

  if (zeroed.length > 0) {
    console.log("Di-nol-kan atas arahan owner (saldo minus tidak masuk akal):");
    for (const z of zeroed) {
      console.log(`  • ${z.code} ${z.name}: ${rp(z.was)} → Rp 0`);
    }
    console.log("");
  }

  const pnlNet = pnl.reduce((s, a) => s + a.net, 0);
  console.log(
    `Hasil usaha Maret–Juni (tidak dibawa per akun, mengendap di ${RETAINED_CODE}): ${rp(-pnlNet)}`,
  );
  console.log(
    `Total masuk ${RETAINED_CODE} ${retainedAcc.name}: ${rp(plug)} (laba/rugi lama + saldo lama + koreksi persediaan)\n`,
  );

  /* Cek kewajaran: GL vs subledger untuk akun yang punya buku pembantu. */
  await reportSubledgerChecks(client, outlet.id, carried);

  console.log("Setelan batas buku yang akan dipasang:");
  console.log(`  booksCutoff.date       = ${CUTOFF}   (jurnal, pembelian, kas, PR, stok)`);
  console.log(`  booksCutoff.opnameDate = ${OPNAME_CUTOFF}   (opname 30 Juni tetap tampil = stok awal Juli)`);
  console.log("");

  if (!confirmed) {
    console.log("ℹ️  DRY-RUN — tidak ada yang diubah. Tambah --confirm untuk eksekusi.\n");
    client.release();
    await pool.end();
    return;
  }

  /* ── Eksekusi (satu transaksi) ──────────────────────────────────────── */
  console.log("🔥 Mengeksekusi...");
  await client.query("BEGIN");
  try {
    // Periode Juli 2026 (buat kalau belum ada).
    const year = Number(CUTOFF.slice(0, 4));
    const month = Number(CUTOFF.slice(5, 7));
    let periodRes = await client.query<{ id: string }>(
      `SELECT id FROM accounting_periods
       WHERE outlet_id = $1 AND period_year = $2 AND period_month = $3`,
      [outlet.id, year, month],
    );
    if (periodRes.rows.length === 0) {
      periodRes = await client.query<{ id: string }>(
        `INSERT INTO accounting_periods (outlet_id, period_year, period_month, status, opened_at)
         VALUES ($1, $2, $3, 'open', now()) RETURNING id`,
        [outlet.id, year, month],
      );
    }
    const periodId = periodRes.rows[0].id;

    const actorRes = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE outlet_id = $1 AND role = 'owner' AND deleted_at IS NULL
       ORDER BY created_at LIMIT 1`,
      [outlet.id],
    );
    const actorId = actorRes.rows[0]?.id;
    if (!actorId) throw new Error("User owner tidak ditemukan untuk created_by");

    // Nomor entry: MAX+1 dalam periode (gap-tolerant, sama dgn posting.ts).
    const seqRes = await client.query<{ max_seq: number }>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number FROM '-([0-9]+)$') AS INT)), 0)::int AS max_seq
       FROM journal_entries WHERE period_id = $1`,
      [periodId],
    );
    const seq = Number(seqRes.rows[0]?.max_seq ?? 0) + 1;
    const entryNumber = `JE-${year}${String(month).padStart(2, "0")}-${String(seq).padStart(4, "0")}`;

    const entryRes = await client.query<{ id: string }>(
      `INSERT INTO journal_entries
         (outlet_id, period_id, entry_number, entry_date, description,
          source_type, source_id, status, posted_at, posted_by, created_by, metadata)
       VALUES ($1,$2,$3,$4,$5,'opening_balance',NULL,'posted',now(),$6,$6,$7)
       RETURNING id`,
      [
        outlet.id,
        periodId,
        entryNumber,
        CUTOFF,
        `Saldo Awal ${CUTOFF} — cutoff mulai bersih dari Juli (sesi AE-207)`,
        actorId,
        JSON.stringify({
          cutoff: CUTOFF,
          opnameCutoff: OPNAME_CUTOFF,
          zeroedAccounts: zeroed,
          priorPeriodResult: -pnlNet,
          note: "Dihitung dari saldo GL per 30 Juni 2026. Koreksi ke angka riil lewat Jurnal Manual.",
        }),
      ],
    );
    const entryId = entryRes.rows[0].id;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await client.query(
        `INSERT INTO journal_lines (entry_id, line_number, account_id, debit, credit, description)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [entryId, i + 1, l.accountId, l.debit, l.credit, `Saldo awal ${l.code}`],
      );
    }

    // Nyalakan batas buku.
    await client.query(
      `UPDATE outlets
       SET settings = jsonb_set(
             COALESCE(settings, '{}'::jsonb), '{booksCutoff}', $2::jsonb, true
           ),
           updated_at = now()
       WHERE id = $1`,
      [
        outlet.id,
        JSON.stringify({
          date: CUTOFF,
          opnameDate: OPNAME_CUTOFF,
          note: "Mulai bersih dari Juli 2026 (sesi AE-207). Data lama disembunyikan, tidak dihapus.",
          setAt: new Date().toISOString(),
        }),
      ],
    );

    await client.query("COMMIT");
    console.log(`\n✅ Selesai. Jurnal ${entryNumber} di-post, batas buku aktif ${CUTOFF}.`);
    console.log("   Verifikasi: npx tsx scripts/_oneshot/cutoff-juli-verify.ts\n");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ Gagal — ROLLBACK:", e);
    client.release();
    await pool.end();
    process.exit(1);
  }

  client.release();
  await pool.end();
}

/** Bandingkan saldo GL yang dibawa vs buku pembantunya, biar drift kelihatan. */
async function reportSubledgerChecks(
  client: PoolClient,
  outletId: string,
  carried: AccRow[],
) {
  const gl = (code: string) => carried.find((a) => a.code === code)?.net ?? 0;

  const ap = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(total_amount),0)::text AS total FROM purchases
     WHERE outlet_id = $1 AND status = 'pending_payment' AND receipt_status <> 'cancelled'`,
    [outletId],
  );
  const kred = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(principal_outstanding),0)::text AS total FROM creditors
     WHERE outlet_id = $1 AND status <> 'settled'`,
    [outletId],
  );

  const idebt = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount),0)::text AS total FROM internal_debt_entries WHERE outlet_id = $1`,
    [outletId],
  );
  const inv = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(modal_disetor),0)::text AS total FROM investors
     WHERE outlet_id = $1 AND status <> 'exited'`,
    [outletId],
  );
  const peng = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(modal_disetor),0)::text AS total FROM pengelola WHERE outlet_id = $1`,
    [outletId],
  );
  const modalSetor =
    Number(inv.rows[0]?.total ?? 0) + Number(peng.rows[0]?.total ?? 0);

  const checks: Array<[string, number, number]> = [
    ["2101 Hutang Dagang", -gl("2101"), Number(ap.rows[0]?.total ?? 0)],
    ["2150 Hutang Kreditur", -gl("2150"), Number(kred.rows[0]?.total ?? 0)],
    ["2170 Hutang Internal", -gl("2170"), Number(idebt.rows[0]?.total ?? 0)],
    ["3101 Modal Owner", -gl("3101"), modalSetor],
  ];

  console.log("Cek GL vs buku pembantu (liability/equity: saldo = sisi kredit):");
  for (const [label, glVal, subVal] of checks) {
    const diff = glVal - subVal;
    const mark = diff === 0 ? "✅" : "⚠️ ";
    console.log(
      `  ${mark} ${label.padEnd(24)} GL ${rp(glVal).padStart(14)}   buku pembantu ${rp(subVal).padStart(14)}${
        diff === 0 ? "" : `   selisih ${rp(diff)}`
      }`,
    );
  }
  console.log(
    "  (selisih dibawa APA ADANYA sesuai arahan owner — koreksi belakangan\n" +
      "   lewat Jurnal Manual. Bukan efek cutoff: drift ini sudah ada sebelumnya.)\n",
  );
}

/** Balikkan: jurnal saldo awal jadi 'reversed', setelan cutoff dihapus. */
async function runUndo(client: PoolClient, outletId: string) {
  const res = await client.query<{ id: string; entry_number: string }>(
    `SELECT id, entry_number FROM journal_entries
     WHERE outlet_id = $1 AND source_type = 'opening_balance' AND status <> 'reversed'`,
    [outletId],
  );
  console.log(
    `Akan dibatalkan: ${res.rows.length} jurnal saldo awal${
      res.rows.length ? " (" + res.rows.map((r) => r.entry_number).join(", ") + ")" : ""
    }`,
  );
  console.log("Setelan booksCutoff akan dikosongkan → semua data lama muncul lagi.\n");

  if (!confirmed) {
    console.log("ℹ️  DRY-RUN — tambah --confirm untuk eksekusi.\n");
    return;
  }

  await client.query("BEGIN");
  try {
    /* Sengaja di-set 'reversed', bukan DELETE: riwayat bahwa pernah ada
     * saldo awal tetap terlihat, dan unique index sumber-aktif tetap bebas
     * kalau nanti mau post ulang. */
    await client.query(
      `UPDATE journal_entries
       SET status = 'reversed',
           reverse_reason = 'Undo cutoff Juli (sesi AE-207)',
           updated_at = now()
       WHERE outlet_id = $1 AND source_type = 'opening_balance' AND status <> 'reversed'`,
      [outletId],
    );
    await client.query(
      `UPDATE outlets SET settings = settings - 'booksCutoff', updated_at = now() WHERE id = $1`,
      [outletId],
    );
    await client.query("COMMIT");
    console.log("✅ Cutoff dibatalkan. Semua data lama tampil kembali.\n");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ Gagal — ROLLBACK:", e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
