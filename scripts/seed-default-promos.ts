/**
 * `npm run seed:default-promos` — idempotent seed of default Kompensasi
 * tier promos (5 nominal tiers + 1 free-bill tier). Safe to re-run; uses
 * the promo `name` as natural key for idempotency.
 *
 * Owner can edit / pause / archive / extend these via Admin → Promo
 * after seed. Keeping the names stable ensures future runs of this
 * script don't duplicate.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull } from "drizzle-orm";
import { outlets, promos, users } from "@/db/schema";
import { getBool, parseCliArgs } from "./_shared/cli-args";

interface DefaultPromo {
  name: string;
  description: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  requiresApproval: boolean;
}

const DEFAULTS: DefaultPromo[] = [
  {
    name: "Kompensasi Ringan -Rp 5.000",
    description: "Kompensasi keluhan ringan (lupa straw, antrean lama, dll)",
    discountType: "fixed",
    discountValue: 5_000,
    requiresApproval: true,
  },
  {
    name: "Kompensasi Sedang -Rp 10.000",
    description: "Kompensasi salah saji yang masih bisa diperbaiki",
    discountType: "fixed",
    discountValue: 10_000,
    requiresApproval: true,
  },
  {
    name: "Kompensasi Berat -Rp 25.000",
    description: "Kompensasi salah order utama (harus refire 1 menu)",
    discountType: "fixed",
    discountValue: 25_000,
    requiresApproval: true,
  },
  {
    name: "Kompensasi Besar -Rp 50.000",
    description: "Kompensasi keluhan serius / multi-item rusak",
    discountType: "fixed",
    discountValue: 50_000,
    requiresApproval: true,
  },
  {
    name: "Kompensasi Refund Penuh 100%",
    description: "Refund total karena bill bermasalah berat (paling jarang)",
    discountType: "percent",
    discountValue: 100,
    requiresApproval: true,
  },
];

async function main() {
  const args = parseCliArgs();
  const apply = getBool(args, "apply");

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  // Resolve outlet (auto-detect single-outlet)
  const outletRows = await db
    .select({ id: outlets.id, name: outlets.name })
    .from(outlets)
    .where(isNull(outlets.deletedAt));
  if (outletRows.length === 0) throw new Error("No outlet");
  if (outletRows.length > 1) throw new Error("Multi-outlet not handled");
  const outletId = outletRows[0].id;

  // Actor (SEED_OWNER_EMAIL)
  let actorId: string | null = null;
  const email = process.env.SEED_OWNER_EMAIL;
  if (email) {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    actorId = u?.id ?? null;
  }

  console.log(`Mode:    ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Outlet:  ${outletRows[0].name} (${outletId})`);
  console.log(`Actor:   ${actorId ?? "(none)"}\n`);

  let toInsert = 0;
  let skipped = 0;

  for (const def of DEFAULTS) {
    const existing = await db
      .select({ id: promos.id, status: promos.status })
      .from(promos)
      .where(
        and(
          eq(promos.outletId, outletId),
          eq(promos.name, def.name),
          isNull(promos.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      console.log(`  SKIP: "${def.name}" (already exists, status=${existing[0].status})`);
      continue;
    }

    toInsert++;
    console.log(`  ADD:  "${def.name}"`);
    if (apply) {
      await db.insert(promos).values({
        outletId,
        name: def.name,
        description: def.description,
        discountType: def.discountType,
        discountValue: def.discountValue,
        scope: "whole_bill",
        requiresApproval: def.requiresApproval,
        status: "active",
        createdBy: actorId,
        updatedBy: actorId,
      });
    }
  }

  console.log(
    `\n${apply ? "Applied" : "Plan"}: insert=${toInsert} skip=${skipped} total=${DEFAULTS.length}`,
  );
  if (!apply) {
    console.log("Re-run with --apply to commit.");
  }

  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
