/**
 * Sesi AE-120 — Cleanup kreditur (Rama mis-input + Lina lunas).
 *
 * Part A: Soft-delete 3 duplicate kreditur entries (Rama mis-input):
 *   Per diag-duplicate-kreditur.ts findings (3 grup duplikat).
 *   Rama pilih: KEEP yang punya nomor HP (entry lebih baru, 14:38-14:39),
 *   DELETE yang tanpa HP (entry lama, 14:27 batch).
 *
 * Part B: Mark Lina Maulida Gunawan lunas + hapus dari list:
 *   Owner: "atas nama lina maulida gunawan hilangkan dari list kreditur
 *   dan investor. sudah lunas sebagai kreditur"
 *   Tidak ada di investors. Di creditors outstanding Rp 1jt tapi sudah
 *   dilunasi offline. Action: set outstanding=0, status='settled',
 *   deleted_at=NOW().
 *
 * Strategy:
 *  - Wrapped in transaction.
 *  - Insert audit log per row.
 *  - UI safety check bypassed (test mis-input / offline settlement).
 *
 * Run dry: npx tsx scripts/_oneshot/cleanup-duplicate-kreditur.ts
 * Run apply: npx tsx scripts/_oneshot/cleanup-duplicate-kreditur.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

/* (keepId, deleteId, namaUntukLog) — dari diag-duplicate-kreditur output.
 * Rama pilih KEEP entry yang punya nomor HP (lebih lengkap). */
const PAIRS: Array<{ keepId: string; deleteId: string; name: string }> = [
  {
    name: "Aan Najmutsaqib",
    keepId: "9cbd2b6e-bbf6-4b1d-bf24-5b40a0f079c5", // has phone +6285815194914
    deleteId: "21ed85ea-b965-4faa-90a1-d3349b3de1bf", // no phone
  },
  {
    name: "Andriansyah",
    keepId: "9bb29f61-0433-4e60-884a-106d322a9632", // has phone +6283819863905
    deleteId: "993c9b26-86af-4011-a8a8-08263a955ef1", // no phone
  },
  {
    name: "Aufa Hanania Binti Eslah",
    keepId: "b9b0d6ac-bf4a-4d3c-b1d8-2e9d7a8891a1", // has phone +60173592102
    deleteId: "6e32fd15-45c6-46b4-9110-9144b5379e68", // no phone
  },
];

const RAMA_EMAIL = "rama.activity98@gmail.com";

/** Lina Maulida Gunawan — sudah lunas offline, hapus dari list. */
const LINA_KREDITUR_ID = "0be0fa2c-7c28-453a-a616-0251cc295886";

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    console.log("=".repeat(70));
    console.log(
      `MODE: ${apply ? "APPLY 🚨 (changes will be persisted)" : "DRY-RUN (no changes)"}`,
    );
    console.log("=".repeat(70));
    console.log();

    /* Resolve actor (Rama). */
    const [actor] = (
      await c.query(`SELECT id, name FROM users WHERE LOWER(email) = LOWER($1)`, [
        RAMA_EMAIL,
      ])
    ).rows;
    if (!actor) throw new Error(`User ${RAMA_EMAIL} tidak ditemukan`);
    const actorId = actor.id as string;
    console.log(`Actor: ${actor.name} (${actorId})\n`);

    /* Pre-flight: re-verify semua keepId + deleteId masih active. */
    console.log("Part A: Duplicate cleanup\nPre-flight verify:");
    for (const p of PAIRS) {
      const rows = (
        await c.query(
          `SELECT id, full_name, phone, principal_outstanding, status, deleted_at,
                  (SELECT COUNT(*) FROM creditor_repayments cr WHERE cr.creditor_id = c.id) AS repay_count
           FROM creditors c
           WHERE id = ANY($1::uuid[])`,
          [[p.keepId, p.deleteId]],
        )
      ).rows;
      const keep = rows.find((r) => r.id === p.keepId);
      const del = rows.find((r) => r.id === p.deleteId);
      if (!keep) throw new Error(`KEEP id ${p.keepId} (${p.name}) tidak ada`);
      if (!del) throw new Error(`DELETE id ${p.deleteId} (${p.name}) tidak ada`);
      if (keep.deleted_at !== null)
        throw new Error(`KEEP id ${p.keepId} sudah ke-deleted`);
      if (del.deleted_at !== null) {
        console.log(`  ⚠ ${p.name}: DELETE id sudah soft-deleted, SKIP`);
        continue;
      }
      if (Number(del.repay_count) > 0) {
        throw new Error(
          `DELETE id ${p.deleteId} (${p.name}) punya ${del.repay_count} repayment — STOP, manual review`,
        );
      }
      console.log(
        `  ✓ ${p.name}: keep ${p.keepId.slice(0, 8)}… (phone=${keep.phone ?? "-"}) | delete ${p.deleteId.slice(0, 8)}… (phone=${del.phone ?? "-"}, outstanding Rp ${Number(del.principal_outstanding).toLocaleString("id-ID")})`,
      );
    }

    /* Part B: Lina pre-flight. */
    console.log("\nPart B: Lina Maulida Gunawan (lunas offline)\nPre-flight verify:");
    const [lina] = (
      await c.query(
        `SELECT id, full_name, principal_original, principal_outstanding, status, deleted_at,
                (SELECT COUNT(*) FROM creditor_repayments cr WHERE cr.creditor_id = c.id) AS repay_count
         FROM creditors c WHERE id = $1`,
        [LINA_KREDITUR_ID],
      )
    ).rows;
    if (!lina) throw new Error(`Lina kreditur ${LINA_KREDITUR_ID} tidak ada`);
    if (lina.deleted_at !== null) {
      console.log(`  ⚠ Lina sudah soft-deleted, SKIP`);
    } else {
      console.log(
        `  ✓ Lina ${LINA_KREDITUR_ID.slice(0, 8)}…: outstanding Rp ${Number(lina.principal_outstanding).toLocaleString("id-ID")} | status=${lina.status} | repayments=${lina.repay_count}`,
      );
      console.log(
        `    → Mark settled (outstanding 0) + soft-delete (offline settlement, no journal posted)`,
      );
    }

    if (!apply) {
      console.log("\n" + "=".repeat(70));
      console.log(
        `DRY-RUN done. Part A: ${PAIRS.length} duplicate. Part B: 1 (Lina) settle+delete.`,
      );
      console.log("Re-run with --apply to execute.");
      console.log("=".repeat(70));
      return;
    }

    /* APPLY: transaction wrap. */
    console.log("\n" + "=".repeat(70));
    console.log("APPLYING…");
    console.log("=".repeat(70));
    await c.query("BEGIN");
    try {
      for (const p of PAIRS) {
        const res = await c.query(
          `UPDATE creditors
             SET deleted_at = NOW(),
                 updated_at = NOW(),
                 updated_by = $1,
                 notes = COALESCE(notes, '') || ' [Duplicate cleanup AE-120: hapus, keep id ' || $2 || ']'
           WHERE id = $3 AND deleted_at IS NULL`,
          [actorId, p.keepId, p.deleteId],
        );
        console.log(
          `  ✓ ${p.name}: soft-deleted ${p.deleteId} (${res.rowCount} row)`,
        );

        /* Audit log per deletion. */
        await c.query(
          `INSERT INTO audit_logs (event_type, user_id, entity_type, entity_id, payload, metadata, created_at)
           VALUES ('creditor.delete', $1, 'creditor', $2, $3::jsonb, $4::jsonb, NOW())`,
          [
            actorId,
            p.deleteId,
            JSON.stringify({
              summary: `Soft-delete duplicate creditor "${p.name}" (kept ${p.keepId})`,
              reason: "duplicate_cleanup_AE120",
              keptCreditorId: p.keepId,
            }),
            JSON.stringify({
              script: "cleanup-duplicate-kreditur.ts",
              session: "AE-120",
            }),
          ],
        );
        console.log(`    audit_logs entry written`);
      }
      /* Part B apply: mark Lina settled + soft-delete. */
      if (lina.deleted_at === null) {
        const linaRes = await c.query(
          `UPDATE creditors
             SET principal_outstanding = 0,
                 status = 'settled',
                 deleted_at = NOW(),
                 updated_at = NOW(),
                 updated_by = $1,
                 notes = COALESCE(notes, '') || ' [AE-120: marked settled, offline payment, removed from list per owner]'
           WHERE id = $2 AND deleted_at IS NULL`,
          [actorId, LINA_KREDITUR_ID],
        );
        console.log(
          `  ✓ Lina Maulida Gunawan: settle + soft-delete (${linaRes.rowCount} row)`,
        );
        await c.query(
          `INSERT INTO audit_logs (event_type, user_id, entity_type, entity_id, payload, metadata, created_at)
           VALUES ('creditor.update', $1, 'creditor', $2, $3::jsonb, $4::jsonb, NOW())`,
          [
            actorId,
            LINA_KREDITUR_ID,
            JSON.stringify({
              summary: `Mark Lina Maulida Gunawan settled (offline payment Rp ${Number(lina.principal_outstanding).toLocaleString("id-ID")}) + remove from list`,
              before: {
                status: lina.status,
                principalOutstanding: Number(lina.principal_outstanding),
              },
              after: {
                status: "settled",
                principalOutstanding: 0,
                deletedAt: "now",
              },
              reason: "offline_settlement_AE120",
            }),
            JSON.stringify({
              script: "cleanup-duplicate-kreditur.ts",
              session: "AE-120",
            }),
          ],
        );
        console.log(`    audit_logs entry written`);
      }

      await c.query("COMMIT");
      console.log("\n" + "=".repeat(70));
      console.log(
        "✅ COMMIT done. 3 duplicate kreditur + 1 Lina settle+delete.",
      );
      console.log("=".repeat(70));
    } catch (e) {
      await c.query("ROLLBACK");
      console.error("\n❌ ROLLBACK due to error:", e);
      throw e;
    }
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
