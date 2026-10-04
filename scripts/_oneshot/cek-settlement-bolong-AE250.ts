import Module from "node:module";
import { Pool } from "@neondatabase/serverless";
const M = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = (r, ...a) => (r === "server-only" ? require.resolve("./server-only-stub.ts") : orig.call(Module, r, ...a));
async function main() {
  const { getPosCashlessGrossByDay } = await import("@/features/finance/queries");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const [o] = (await pool.query(`SELECT id FROM outlets WHERE deleted_at IS NULL LIMIT 1`)).rows;
  const rows = (await pool.query(
    `SELECT channel, period_from::text f FROM aggregator_settlements WHERE outlet_id=$1 AND period_from >= '2026-09-01'`, [o.id])).rows;
  const have = new Set(rows.map((r) => `${r.channel}|${r.f}`));
  const map = { qris: "qris", cardBca: "edc_bca", cardBni: "edc_bni", cardBri: "edc_bri", cardOther: "edc_other" } as const;
  for (let d = new Date("2026-09-01T00:00:00Z"); d <= new Date("2026-10-03T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const g = await getPosCashlessGrossByDay(o.id, iso);
    for (const [k, ch] of Object.entries(map)) {
      const v = (g as unknown as Record<string, number>)[k];
      if (v > 0 && !have.has(`${ch}|${iso}`)) console.log("BOLONG", iso, ch, v);
    }
  }
  await pool.end();
  process.exit(0);
}
main();
