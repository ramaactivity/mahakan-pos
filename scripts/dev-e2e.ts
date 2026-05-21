/**
 * Sesi AE-85 — Spawn next dev dengan .env.test loaded.
 *
 * Pakai supaya Playwright webServer bisa run dev server pointing ke
 * Neon branch (E2E test DB) bukan prod DB.
 *
 *   npx tsx scripts/dev-e2e.ts
 *
 * Atau via npm script: npm run dev:e2e
 */

import { config } from "dotenv";
import { spawn } from "child_process";
import { existsSync } from "fs";

const envPath = ".env.test";
if (!existsSync(envPath)) {
  console.error(`✗ ${envPath} tidak ada. Lihat e2e/tier2/_README.md.`);
  process.exit(1);
}

config({ path: envPath });

if (!process.env.DATABASE_URL) {
  console.error(`✗ ${envPath} tidak set DATABASE_URL`);
  process.exit(1);
}

console.log(`▶ Loading env dari ${envPath}`);
console.log(
  `▶ DATABASE_URL: ${process.env.DATABASE_URL.replace(/:[^@]+@/, ":***@")}`,
);

const port = process.env.E2E_PORT ?? "3001";
console.log(`▶ Starting next dev di port ${port}`);

const child = spawn(
  "npx",
  ["next", "dev", "--port", port, "--turbopack"],
  {
    stdio: "inherit",
    env: { ...process.env, PORT: port, NEXTAUTH_URL: `http://localhost:${port}` },
  },
);

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
