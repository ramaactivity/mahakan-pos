/**
 * `npm run verify:migrations` — compare local drizzle journal vs prod DB
 * `__drizzle_migrations` table. Surface drift sebelum app crash karena
 * "relation does not exist".
 *
 * Trigger insiden sesi AC-3+5: migration 0029 + 0030 reported "applied
 * successfully" by drizzle-kit, tapi target DB ternyata bukan production
 * (DATABASE_URL di .env.local mismatch). Owner re-pull env + re-run migrate
 * harus jadi standard sebelum trust "migrations applied".
 *
 * Pakai DATABASE_URL dari .env.local. Sebelum verify prod, jalankan dulu:
 *   npx vercel env pull .env.local --environment production --yes
 *
 * Output:
 *   - SYNC: kalau journal local + DB match
 *   - DRIFT: list migration yang ada di local journal tapi belum di DB,
 *     atau sebaliknya
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "@neondatabase/serverless";

// Raw .env.local loader — no `$variable` expansion (Neon passwords kadang
// punya `$` yang dotenv salah-expand jadi empty). Mirror scripts/migrate.ts.
function loadEnvRaw(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf-8");
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
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvRaw(resolve(process.cwd(), ".env.local"));

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface JournalFile {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

interface DrizzleMigrationRow {
  id: number;
  hash: string;
  created_at: string;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL not set in .env.local");
    process.exit(1);
  }

  const journalPath = resolve(
    process.cwd(),
    "drizzle/migrations/meta/_journal.json",
  );
  const journal = JSON.parse(
    readFileSync(journalPath, "utf-8"),
  ) as JournalFile;

  const localTags = journal.entries.map((e) => e.tag).sort();
  console.log(
    `📂 Local journal: ${localTags.length} migrations (latest: ${localTags[localTags.length - 1]})`,
  );

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const dbHost = (() => {
      try {
        return new URL(process.env.DATABASE_URL!).host;
      } catch {
        return "(invalid URL)";
      }
    })();
    console.log(`🔌 Connected to: ${dbHost}\n`);

    // Drizzle stores migration hashes in drizzle.__drizzle_migrations.
    // The `hash` column is the SHA256 of migration SQL — not the tag — but
    // creation order maps 1:1 to journal entries.
    const res = await pool.query<DrizzleMigrationRow>(
      `SELECT id, hash, to_char(to_timestamp(created_at / 1000.0), 'YYYY-MM-DD HH24:MI:SS') AS created_at
       FROM drizzle.__drizzle_migrations
       ORDER BY id ASC`,
    );
    const dbCount = res.rows.length;
    const journalCount = journal.entries.length;

    console.log(
      `🗄️  DB drizzle.__drizzle_migrations: ${dbCount} rows applied`,
    );

    if (dbCount === journalCount) {
      console.log(`\n✅ SYNC — local + DB sama (${dbCount} migrations).`);
    } else if (dbCount < journalCount) {
      const missing = journal.entries.slice(dbCount);
      console.log(
        `\n❌ DRIFT — DB tertinggal ${missing.length} migration:`,
      );
      for (const m of missing) {
        console.log(`   - ${m.tag} (idx ${m.idx})`);
      }
      console.log(
        `\n   Fix: npm run db:migrate (target DB akan di-update)`,
      );
      process.exit(2);
    } else {
      console.log(
        `\n⚠️  DB > local journal (${dbCount} vs ${journalCount}). DB punya entry yang tidak ada di repo. Investigate.`,
      );
      process.exit(3);
    }

    // Spot-check critical tables exist (catch silent migration target mismatch
    // where __drizzle_migrations entry exists tapi tabel-nya gagal create).
    const criticalTables = [
      "purchase_requests",
      "purchase_request_items",
      "settlement_logs",
      "chart_of_accounts",
      "attendance_records",
    ];
    const tablesRes = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
      [criticalTables],
    );
    const presentTables = new Set(tablesRes.rows.map((r) => r.tablename));
    const missingTables = criticalTables.filter((t) => !presentTables.has(t));
    if (missingTables.length > 0) {
      console.log(
        `\n❌ Critical tables MISSING from DB:\n   ${missingTables.join(", ")}`,
      );
      console.log(
        `   __drizzle_migrations count cocok tapi tabel tidak ada — possible journal/DB drift.`,
      );
      process.exit(4);
    }

    console.log(
      `\n✅ Critical tables present: ${criticalTables.join(", ")}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
