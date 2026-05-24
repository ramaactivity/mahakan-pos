/**
 * Sesi AE-144 — Hapus riwayat opname testing untuk outlet aktif.
 *
 * Anisa request via Owner: "tolong hapus riwayat stock opname sebelumnya.
 * itu hanya testing dari anisa saja." → tampilan Opname tab clean, tidak
 * bingung.
 *
 * Yang dihapus (cascade-safe order):
 *   1. inventory_movements yang ter-link via stock_opname_lines.movement_id
 *      (adjust movements yang dibuat saat opname finalize).
 *   2. stock_opname_sessions → CASCADE auto-delete stock_opname_lines.
 *
 * Audit logs (eventType opname.*) di-PRESERVE — owner mau riwayat audit
 * tetap ada untuk traceability, hanya UI tab Opname yang clean.
 *
 * Catatan: stock current tidak di-reverse. Karena Anisa baru reset semua
 * stock ke 0 di sesi AE-141, state inventory sudah fresh. Movement adjust
 * lama hanya jadi historical artifact yang nggak boleh muncul lagi di UI.
 *
 * Dry-run default. Apply: --apply. Outlet: by default semua sessions per
 * outlet pertama; bisa ke-scope dengan --outletId=<uuid>.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  auditLogs,
  inventoryMovements,
  outlets,
  stockOpnameLines,
  stockOpnameSessions,
  users,
} from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const APPLY = process.argv.includes("--apply");
const OUTLET_ARG = process.argv.find((a) => a.startsWith("--outletId="));
const outletIdOverride = OUTLET_ARG ? OUTLET_ARG.split("=")[1] : null;

async function main() {
  console.log(
    `\n=== Purge Opname History (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`,
  );

  /* Resolve outlet. */
  let outletId: string;
  if (outletIdOverride) {
    outletId = outletIdOverride;
  } else {
    const [first] = await db.select({ id: outlets.id, name: outlets.name }).from(outlets).limit(1);
    if (!first) {
      console.error("Tidak ada outlet di database.");
      await pool.end();
      process.exit(1);
    }
    outletId = first.id;
    console.log(`Outlet: ${first.name} (${first.id})`);
  }

  /* List semua opname sessions di outlet. */
  const sessions = await db
    .select({
      id: stockOpnameSessions.id,
      periodLabel: stockOpnameSessions.periodLabel,
      status: stockOpnameSessions.status,
      startedAt: stockOpnameSessions.startedAt,
      totalLines: stockOpnameSessions.totalLines,
      countedLines: stockOpnameSessions.countedLines,
      totalDiffCost: stockOpnameSessions.totalDiffCost,
    })
    .from(stockOpnameSessions)
    .where(eq(stockOpnameSessions.outletId, outletId));

  if (sessions.length === 0) {
    console.log("Tidak ada opname session untuk dihapus.");
    await pool.end();
    process.exit(0);
  }

  console.log(`Total opname sessions: ${sessions.length}`);
  for (const s of sessions) {
    console.log(
      `  - ${s.periodLabel.padEnd(15)} ${s.status.padEnd(15)} ${s.startedAt.toISOString()} (${s.countedLines}/${s.totalLines} lines, ΔCost ${s.totalDiffCost})`,
    );
  }

  const sessionIds = sessions.map((s) => s.id);

  /* Collect movement ids dari lines yang punya movement_id (finalized). */
  const lineRows = await db
    .select({
      id: stockOpnameLines.id,
      movementId: stockOpnameLines.movementId,
    })
    .from(stockOpnameLines)
    .where(
      and(
        inArray(stockOpnameLines.sessionId, sessionIds),
        isNotNull(stockOpnameLines.movementId),
      ),
    );

  const movementIds = lineRows
    .map((l) => l.movementId)
    .filter((m): m is string => m !== null);

  /* Count total lines (termasuk yang tidak punya movement). */
  const allLines = await db
    .select({ id: stockOpnameLines.id })
    .from(stockOpnameLines)
    .where(inArray(stockOpnameLines.sessionId, sessionIds));

  console.log(`\nYang akan dihapus:`);
  console.log(`  - ${sessions.length} stock_opname_sessions`);
  console.log(
    `  - ${allLines.length} stock_opname_lines (cascade auto-delete)`,
  );
  console.log(
    `  - ${movementIds.length} inventory_movements (adjust dari opname finalize)`,
  );

  if (!APPLY) {
    console.log(
      `\n[DRY-RUN] Pass --apply untuk eksekusi delete. Audit logs di-preserve.`,
    );
    await pool.end();
    process.exit(0);
  }

  console.log(`\n[APPLY] Deleting...`);

  /* Resolve actor untuk audit row. */
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
    /* 1. Clear movementId references di lines (defensive — supaya FK
     *    constraint nggak protest saat delete movement). */
    if (movementIds.length > 0) {
      await tx
        .update(stockOpnameLines)
        .set({ movementId: null })
        .where(inArray(stockOpnameLines.sessionId, sessionIds));

      /* 2. Delete inventory_movements. */
      await tx
        .delete(inventoryMovements)
        .where(inArray(inventoryMovements.id, movementIds));
    }

    /* 3. Delete sessions — cascade lines via FK onDelete:"cascade". */
    await tx
      .delete(stockOpnameSessions)
      .where(inArray(stockOpnameSessions.id, sessionIds));

    /* 4. Audit row untuk traceability. */
    if (actorId) {
      await tx.insert(auditLogs).values({
        userId: actorId,
        eventType: "inventory.opname_history_purged",
        entityType: "stock_opname_session",
        entityId: null,
        payload: {
          summary: `Purge ${sessions.length} opname sessions (${allLines.length} lines, ${movementIds.length} adjust movements). Reason: testing data per Anisa via Owner request.`,
          sessionIds,
          movementIds,
          sessionDetails: sessions.map((s) => ({
            id: s.id,
            periodLabel: s.periodLabel,
            status: s.status,
            startedAt: s.startedAt.toISOString(),
          })),
        },
        metadata: {
          actorRole: "owner",
          source: "scripts/_oneshot/purge-opname-history.ts",
        },
      });
    }
  });

  console.log(
    `✓ Purged ${sessions.length} sessions + ${allLines.length} lines + ${movementIds.length} movements.`,
  );
  if (!actorId) {
    console.log("⚠ Tidak emit audit row (actor tidak ditemukan).");
  }
  await pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await pool.end();
  process.exit(1);
});
