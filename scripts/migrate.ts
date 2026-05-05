/**
 * `npm run db:migrate:safe` — drop-in replacement for `drizzle-kit migrate`
 * yang LOAD `.env.local` raw tanpa `$variable` expansion.
 *
 * drizzle-kit's bundled dotenv expands `$VAR` di value. Neon-generated
 * passwords kadang punya `$` (mis. `npg_xxxx$yyyy`) — dotenv treats `$yyyy`
 * sebagai variable reference, expand jadi empty string, DATABASE_URL rusak,
 * drizzle-kit error "DATABASE_URL is required" walau line ada di file.
 *
 * Script ini parse .env.local manual (no expansion), set process.env, lalu
 * run drizzle's programmatic migrate function. Behavior identical dengan
 * `drizzle-kit migrate` dari sisi DB state.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

function loadEnvRaw(path: string): number {
  if (!existsSync(path)) return 0;
  const content = readFileSync(path, "utf-8");
  let count = 0;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
      count++;
    }
  }
  return count;
}

async function main() {
  const envPath = resolve(process.cwd(), ".env.local");
  const loaded = loadEnvRaw(envPath);
  console.log(`📂 Loaded ${loaded} env vars from .env.local (raw, no expansion)`);

  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL not set after loading .env.local");
    process.exit(1);
  }

  const dbHost = (() => {
    try {
      return new URL(process.env.DATABASE_URL).host;
    } catch {
      return "(invalid URL)";
    }
  })();
  console.log(`🔌 Connecting to: ${dbHost}\n`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  try {
    await migrate(db, { migrationsFolder: "./drizzle/migrations" });
    console.log("\n✅ Migrations applied successfully.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ Migrate failed:", err);
  process.exit(1);
});
