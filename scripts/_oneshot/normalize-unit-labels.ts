/**
 * Sesi AE-148 — Normalize unit labels across ingredient master.
 *
 * Owner feedback: di CSV data ada "pack", "Pack", "Packs" semua dianggap
 * unit yang sama tapi di-store sebagai string berbeda → opname picker
 * tampak duplikat ("pack" + "Packs" sebagai 2 entry).
 *
 * Aturan normalisasi:
 *  1. Trim whitespace (mis. "pack " → "pack")
 *  2. Lowercase (Pack/PACK → pack)
 *  3. Strip trailing "s" untuk plural kalau hasilnya > 3 char
 *     (packs → pack, bukan ml → m)
 *
 * Field yang di-normalize:
 *  - ingredients.unit (recipe unit)
 *  - ingredients.unit_belanja (purchase unit)
 *  - ingredients.unit_tracking (legacy display tier)
 *  - ingredients.pack_conversions[].unit_label (jsonb)
 *
 * Plus: dedup pack_conversions yang exact-match purchase unit after
 * norm (mis. unit_belanja="pack" + pack_conversion={unitLabel:"Packs"}
 * → drop the pack_conversion).
 *
 * Dry-run default. Apply: --apply.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull } from "drizzle-orm";
import { auditLogs, ingredients, outlets, users } from "@/db/schema";
import { normalizeUnitLabel } from "@/lib/unit-conversion";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const APPLY = process.argv.includes("--apply");

interface PackConversionEntry {
  unitLabel: string;
  qtyPerBase: number;
}

interface IngredientRow {
  id: string;
  name: string;
  unit: string;
  unitBelanja: string | null;
  unitBelanjaPerCogs: string | null;
  unitTracking: string | null;
  unitTrackingPerCogs: string | null;
  packConversions: PackConversionEntry[] | null;
}

interface ChangeDiff {
  id: string;
  name: string;
  unitOld: string;
  unitNew: string;
  unitChanged: boolean;
  belanjaOld: string | null;
  belanjaNew: string | null;
  belanjaChanged: boolean;
  trackingOld: string | null;
  trackingNew: string | null;
  trackingChanged: boolean;
  packsOld: PackConversionEntry[] | null;
  packsNew: PackConversionEntry[] | null;
  packsChanged: boolean;
}

async function main() {
  console.log(
    `\n=== Normalize Unit Labels (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`,
  );

  const [outlet] = await db
    .select({ id: outlets.id, name: outlets.name })
    .from(outlets)
    .where(isNull(outlets.deletedAt))
    .limit(1);
  if (!outlet) {
    console.error("Outlet tidak ditemukan");
    await pool.end();
    process.exit(1);
  }
  console.log(`Outlet: ${outlet.name}\n`);

  const rows = (await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      unitBelanja: ingredients.unitBelanja,
      unitBelanjaPerCogs: ingredients.unitBelanjaPerCogs,
      unitTracking: ingredients.unitTracking,
      unitTrackingPerCogs: ingredients.unitTrackingPerCogs,
      packConversions: ingredients.packConversions,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, outlet.id),
        isNull(ingredients.deletedAt),
      ),
    )) as IngredientRow[];

  const changes: ChangeDiff[] = [];

  for (const r of rows) {
    const unitNew = normalizeUnitLabel(r.unit);
    const belanjaNewRaw = r.unitBelanja
      ? normalizeUnitLabel(r.unitBelanja)
      : null;
    const trackingNewRaw = r.unitTracking
      ? normalizeUnitLabel(r.unitTracking)
      : null;

    /* Dedup pack_conversions: drop entry yang norm-nya sama dengan
     * unit_belanja atau unit_tracking atau unit recipe (after norm).
     * Sesi AE-148 ADD: dedup by MULTIPLIER juga — kalau pack-conv punya
     * qtyPerBase sama dengan unitBelanjaPerCogs / unitTrackingPerCogs,
     * itu duplikat konseptual → drop. */
    const seen = new Set<string>();
    if (unitNew) seen.add(unitNew);
    if (belanjaNewRaw) seen.add(belanjaNewRaw);
    if (trackingNewRaw) seen.add(trackingNewRaw);

    const seenMultipliers = new Set<number>();
    /* Recipe selalu multiplier 1. */
    seenMultipliers.add(1);
    if (r.unitBelanjaPerCogs) {
      const m = Number(r.unitBelanjaPerCogs);
      if (Number.isFinite(m) && m > 0) seenMultipliers.add(m);
    }
    if (r.unitTrackingPerCogs) {
      const m = Number(r.unitTrackingPerCogs);
      if (Number.isFinite(m) && m > 0) seenMultipliers.add(m);
    }

    const packsNew: PackConversionEntry[] | null = r.packConversions
      ? r.packConversions
          .map((p) => ({
            unitLabel: normalizeUnitLabel(p.unitLabel),
            qtyPerBase: p.qtyPerBase,
          }))
          .filter((p) => {
            if (p.unitLabel.length === 0) return false;
            if (seen.has(p.unitLabel)) return false;
            if (seenMultipliers.has(p.qtyPerBase)) return false;
            seen.add(p.unitLabel);
            seenMultipliers.add(p.qtyPerBase);
            return true;
          })
      : null;

    /* Detect change. */
    const unitChanged = unitNew !== r.unit;
    const belanjaChanged = (belanjaNewRaw ?? "") !== (r.unitBelanja ?? "");
    const trackingChanged = (trackingNewRaw ?? "") !== (r.unitTracking ?? "");
    const packsChanged =
      JSON.stringify(packsNew ?? []) !== JSON.stringify(r.packConversions ?? []);

    if (unitChanged || belanjaChanged || trackingChanged || packsChanged) {
      changes.push({
        id: r.id,
        name: r.name,
        unitOld: r.unit,
        unitNew,
        unitChanged,
        belanjaOld: r.unitBelanja,
        belanjaNew: belanjaNewRaw,
        belanjaChanged,
        trackingOld: r.unitTracking,
        trackingNew: trackingNewRaw,
        trackingChanged,
        packsOld: r.packConversions,
        packsNew,
        packsChanged,
      });
    }
  }

  console.log(`Total bahan: ${rows.length}`);
  console.log(`Bahan yang akan di-normalize: ${changes.length}\n`);

  if (changes.length === 0) {
    console.log("Semua unit label sudah konsisten — tidak ada perubahan.");
    await pool.end();
    process.exit(0);
  }

  console.log("Daftar perubahan:");
  for (const c of changes.slice(0, 40)) {
    const parts: string[] = [];
    if (c.unitChanged) parts.push(`unit: "${c.unitOld}" → "${c.unitNew}"`);
    if (c.belanjaChanged) {
      parts.push(
        `belanja: "${c.belanjaOld ?? ""}" → "${c.belanjaNew ?? ""}"`,
      );
    }
    if (c.trackingChanged) {
      parts.push(
        `tracking: "${c.trackingOld ?? ""}" → "${c.trackingNew ?? ""}"`,
      );
    }
    if (c.packsChanged) {
      parts.push(
        `packs: ${JSON.stringify(c.packsOld ?? [])} → ${JSON.stringify(c.packsNew ?? [])}`,
      );
    }
    console.log(`  ${c.name.padEnd(35)} ${parts.join(" | ")}`);
  }
  if (changes.length > 40) {
    console.log(`  ... ${changes.length - 40} bahan lain`);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] Pass --apply untuk eksekusi.`);
    await pool.end();
    process.exit(0);
  }

  console.log(`\n[APPLY] Updating...`);

  /* Resolve actor untuk audit. */
  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  const actor = ownerEmail
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, ownerEmail))
        .limit(1)
    : await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "owner"))
        .limit(1);
  const actorId = actor[0]?.id ?? null;

  await db.transaction(async (tx) => {
    for (const c of changes) {
      const setValues: Record<string, unknown> = { updatedAt: new Date() };
      if (c.unitChanged) setValues.unit = c.unitNew;
      if (c.belanjaChanged) {
        setValues.unitBelanja =
          c.belanjaNew && c.belanjaNew.length > 0 ? c.belanjaNew : null;
      }
      if (c.trackingChanged) {
        setValues.unitTracking =
          c.trackingNew && c.trackingNew.length > 0 ? c.trackingNew : null;
      }
      if (c.packsChanged) {
        setValues.packConversions =
          c.packsNew && c.packsNew.length > 0 ? c.packsNew : null;
      }
      if (actorId) setValues.updatedBy = actorId;
      await tx
        .update(ingredients)
        .set(setValues)
        .where(eq(ingredients.id, c.id));
    }

    if (actorId) {
      await tx.insert(auditLogs).values({
        userId: actorId,
        eventType: "inventory.unit_labels_normalized",
        entityType: "ingredient",
        entityId: null,
        payload: {
          summary: `Normalize ${changes.length} ingredient unit labels (lowercase + dedup plural variants).`,
          changesSummary: changes.map((c) => ({
            id: c.id,
            name: c.name,
            unitOld: c.unitOld,
            unitNew: c.unitNew,
            belanjaOld: c.belanjaOld,
            belanjaNew: c.belanjaNew,
            trackingOld: c.trackingOld,
            trackingNew: c.trackingNew,
            packsOld: c.packsOld,
            packsNew: c.packsNew,
          })),
        },
        metadata: {
          actorRole: "owner",
          source: "scripts/_oneshot/normalize-unit-labels.ts",
        },
      });
    }
  });

  console.log(`\n✓ Normalized ${changes.length} ingredient unit labels.`);
  await pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await pool.end();
  process.exit(1);
});
