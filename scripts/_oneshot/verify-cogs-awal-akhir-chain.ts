/**
 * Read-only: jalankan getCogsReport (tab "Cost of Goods Sold") untuk beberapa
 * bulan berturut-turut, lalu buktikan STOK AKHIR bulan N == STOK AWAL bulan N+1
 * per bahan. Juga hitung baris dengan pemakaian minus.
 *
 * Run: npx tsx --env-file-if-exists=.env.local scripts/_oneshot/verify-cogs-awal-akhir-chain.ts
 */
export {};

async function main() {
  const { db } = await import("@/db");
  const { isNull } = await import("drizzle-orm");
  const { outlets } = await import("@/db/schema");
  const { getCogsReport } = await import("@/features/cogs/queries");

  const [outlet] = await db
    .select()
    .from(outlets)
    .where(isNull(outlets.deletedAt))
    .limit(1);
  if (!outlet) throw new Error("No outlet");
  console.log(`Outlet: ${outlet.name}\n`);

  const months = ["2026-05", "2026-06", "2026-07", "2026-08"];
  const akhirByMonth = new Map<string, Map<string, number>>();

  for (const ym of months) {
    const rep = await getCogsReport({ outletId: outlet.id, ym });
    const minus = rep.rows.filter((r) => r.cogsQty < 0);
    console.log(`=== ${rep.period.label} ===`);
    console.log(
      `  stok awal  : ${rep.lastOpname.before ? `${rep.lastOpname.before.periodLabel} (hitung ${rep.lastOpname.before.countedAt})` : "— (fallback)"}`,
    );
    console.log(
      `  stok akhir : ${rep.lastOpname.within ? `${rep.lastOpname.within.periodLabel} (hitung ${rep.lastOpname.within.countedAt})` : "— (stok saat ini)"}`,
    );
    console.log(
      `  baris      : ${rep.rows.length} · pemakaian minus: ${minus.length} · total COGS Rp ${rep.summary.total.toLocaleString("id-ID")}`,
    );
    for (const b of rep.banners) console.log(`  ⚠ ${b}`);
    if (minus.length > 0) {
      console.log("  contoh minus:");
      for (const r of minus.slice(0, 5)) {
        console.log(
          `    ${r.name.padEnd(26).slice(0, 26)} awal=${r.stockAwalQty} beli=${r.pembelianQty} akhir=${r.stockAkhirQty} pakai=${r.cogsQty}`,
        );
      }
    }
    console.log();

    akhirByMonth.set(
      ym,
      new Map(rep.rows.map((r) => [r.ingredientId, r.stockAkhirQty])),
    );
    awalByMonth.set(
      ym,
      new Map(rep.rows.map((r) => [r.ingredientId, r.stockAwalQty])),
    );
  }

  console.log("=== RANTAI: stok akhir bulan N == stok awal bulan N+1? ===");
  for (let i = 0; i < months.length - 1; i++) {
    const a = akhirByMonth.get(months[i])!;
    const b = awalByMonth.get(months[i + 1])!;
    let same = 0;
    let diff = 0;
    const samples: string[] = [];
    for (const [ingId, akhir] of a) {
      const awal = b.get(ingId);
      if (awal === undefined) continue;
      if (Math.abs(akhir - awal) < 0.0001) same++;
      else {
        diff++;
        if (samples.length < 5) samples.push(`${ingId.slice(0, 8)} akhir=${akhir} awal=${awal}`);
      }
    }
    console.log(
      `${months[i]} → ${months[i + 1]}: cocok ${same}, beda ${diff}${samples.length ? " | " + samples.join(" ; ") : ""}`,
    );
  }

  process.exit(0);
}

const awalByMonth = new Map<string, Map<string, number>>();

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
