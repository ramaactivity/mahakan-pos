import "server-only";
import { Pool } from "@neondatabase/serverless";
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
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;
