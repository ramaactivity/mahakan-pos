/**
 * Diagnostic: cek di mana drizzle migration state di-track + apakah tabel
 * critical sudah ada. Run via: npx tsx scripts/check-migrations-state.ts
 * (assume DATABASE_URL sudah di-load via shell env atau .env.local manual).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "@neondatabase/serverless";

function loadEnvRaw(path: string) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf-8");
  let pending: { key: string; value: string; quote: '"' | "'" } | null = null;
  for (const rawLine of content.split("\n")) {
    if (pending) {
      const closeIdx = rawLine.indexOf(pending.quote);
      if (closeIdx >= 0) {
        if (!process.env[pending.key])
          process.env[pending.key] = pending.value + "\n" + rawLine.slice(0, closeIdx);
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
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0] as '"' | "'";
      const inner = value.slice(1);
      const closeIdx = inner.lastIndexOf(quote);
      if (closeIdx >= 0 && /^\s*$/.test(inner.slice(closeIdx + 1))) {
        value = inner.slice(0, closeIdx);
      } else {
        pending = { key, value: inner, quote };
        continue;
      }
    } else {
      value = value.trim();
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvRaw(resolve(process.cwd(), ".env.local"));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Where is __drizzle_migrations?
    const tablesByName = await pool.query<{
      table_schema: string;
      table_name: string;
    }>(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_name = '__drizzle_migrations'`,
    );
    console.log(
      "__drizzle_migrations locations:",
      JSON.stringify(tablesByName.rows, null, 2),
    );

    // Latest entries in each location
    for (const row of tablesByName.rows) {
      const q = `SELECT id, hash, to_char(to_timestamp(created_at/1000.0), 'YYYY-MM-DD HH24:MI:SS') AS at
                 FROM "${row.table_schema}".__drizzle_migrations
                 ORDER BY id DESC LIMIT 5`;
      const res = await pool.query(q);
      console.log(
        `\nTop 5 in ${row.table_schema}.__drizzle_migrations (${res.rowCount} returned):`,
      );
      console.log(JSON.stringify(res.rows, null, 2));
    }

    // Critical tables
    const tableCheck = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_catalog.pg_tables
       WHERE schemaname='public'
       AND tablename IN ('purchase_requests','purchase_request_items','settlement_logs','chart_of_accounts','attendance_records')
       ORDER BY tablename`,
    );
    console.log(
      "\nCritical tables in public:",
      tableCheck.rows.map((r) => r.tablename).join(", ") || "(none)",
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
