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

function loadEnvRaw(path: string): { count: number; keys: string[] } {
  if (!existsSync(path)) return { count: 0, keys: [] };
  const content = readFileSync(path, "utf-8");

  // Multi-line value support: track when di-dalam quoted value yang belum
  // tertutup, akumulasi sampai closing quote ketemu. Vercel CLI kadang
  // wrap long values seperti VERCEL_OIDC_TOKEN dengan literal newlines.
  const entries: Array<[string, string]> = [];
  let pending: { key: string; value: string; quote: '"' | "'" } | null = null;

  for (const rawLine of content.split("\n")) {
    if (pending) {
      const closeIdx = rawLine.indexOf(pending.quote);
      if (closeIdx >= 0) {
        pending.value += "\n" + rawLine.slice(0, closeIdx);
        entries.push([pending.key, pending.value]);
        pending = null;
      } else {
        pending.value += "\n" + rawLine;
      }
      continue;
    }
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;
    let value = line.slice(eq + 1);

    // Detect unterminated quote (value starts with quote but doesn't end
    // with the same one on this line).
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0] as '"' | "'";
      const inner = value.slice(1);
      const closeIdx = inner.lastIndexOf(quote);
      if (closeIdx >= 0 && /^\s*$/.test(inner.slice(closeIdx + 1))) {
        value = inner.slice(0, closeIdx);
      } else {
        // Unterminated — accumulate next lines.
        pending = { key, value: inner, quote };
        continue;
      }
    } else {
      value = value.trim();
    }

    entries.push([key, value]);
  }

  const keys: string[] = [];
  let count = 0;
  for (const [key, value] of entries) {
    if (!process.env[key]) {
      process.env[key] = value;
      count++;
    }
    keys.push(key);
  }
  return { count, keys };
}

async function main() {
  const envPath = resolve(process.cwd(), ".env.local");
  const { count, keys } = loadEnvRaw(envPath);
  console.log(
    `📂 Loaded ${count} env vars from .env.local (raw, multi-line aware)`,
  );
  console.log(`   Keys: ${keys.sort().join(", ")}\n`);

  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL not set after loading .env.local");
    console.error(
      "   Diagnostic: cek apakah ada di file dengan `grep -n \"^DATABASE_URL\" .env.local`",
    );
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
