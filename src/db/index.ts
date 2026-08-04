import "server-only";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required (set in .env.local)");
}

/**
 * Sesi AE-63 audit P1.4 — Connection pool config untuk Vercel serverless +
 * Neon Postgres. Pre-fix: pool created tanpa config → unlimited connections
 * bisa exhaust Neon free-tier limit (20 max). Concurrent burst dari multiple
 * serverless function invocations menyentuh DB simultaneously.
 *
 * Config:
 * - max: 10 — leave headroom dari 20 Neon limit, allow other lambda + dev.
 * - idleTimeoutMillis: 30s — recycle idle connections cepat di serverless
 *   yang short-lived. Default 10s di Pool, biar lebih lama untuk reuse.
 * - connectionTimeoutMillis: 5s — fail fast kalau Neon slow, jangan
 *   block request hingga Vercel 10s timeout.
 *
 * Sesi AE-182 (audit "Connection terminated unexpectedly", 2026-08-04):
 *
 * 1. `poolQueryViaFetch = true` — query tunggal (SELECT/INSERT/UPDATE di luar
 *    transaksi) dikirim lewat HTTP fetch ke Neon, BUKAN lewat WebSocket yang
 *    persistent. Socket persistent adalah sumber utama error "Connection
 *    terminated unexpectedly": saat instance serverless dibekukan lalu
 *    dibangunkan lagi, socket di pool sudah mati tapi kode baru tahu setelah
 *    query dikirim. HTTP stateless → tidak ada socket basi.
 *    `db.transaction()` tetap pakai WebSocket (memang butuh sesi), jadi
 *    atomicitas jurnal & penjualan tidak berubah.
 *
 * 2. Handler `pool.on("error")` — tanpa ini, error dari koneksi idle yang
 *    diputus server keluar sebagai unhandled rejection dan bisa menjatuhkan
 *    proses. Kita cukup catat, pool akan bikin koneksi baru sendiri.
 */
neonConfig.poolQueryViaFetch = true;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err: Error) => {
  /* Koneksi idle diputus Neon/proxy. Bukan error request aktif — jangan
   * sampai jadi unhandled rejection. */
  console.error("[db-pool] idle client error:", err.message);
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;
