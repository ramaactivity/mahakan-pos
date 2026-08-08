import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { outlets } from "@/db/schema";

/**
 * Feature flag: auto-journal hooks aktif kalau outlets.settings.features.accounting_auto_journal === true.
 * Default OFF — Owner toggle ON di Settings UI setelah test 1 trx dummy + verify journal entry benar.
 *
 * Cached per-request via WeakMap on outletId? No — keep simple, direct DB read.
 * Outlets table small, query cheap, hit rate per request = ~1.
 */
export async function isAutoJournalEnabled(outletId: string): Promise<boolean> {
  const [row] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, outletId))
    .limit(1);
  if (!row) return false;
  const settings = row.settings as Record<string, unknown> | null;
  if (!settings || typeof settings !== "object") return false;
  const features = (settings as { features?: Record<string, unknown> }).features;
  if (!features || typeof features !== "object") return false;
  return features.accounting_auto_journal === true;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sesi AE-193 — tanggal mulai berlakunya jurnal penjualan HARIAN
 * (`outlets.settings.features.dailyJournalSince`, format YYYY-MM-DD).
 *
 * Sengaja berupa TANGGAL, bukan sakelar on/off: riwayat jurnal per-transaksi
 * sebelum tanggal ini harus tetap apa adanya, sementara transaksi sejak
 * tanggal ini diringkas per hari. Dengan begitu cutover tidak pernah
 * meninggalkan hari yang terjurnal dua kali maupun yang bolong.
 *
 * null = belum diaktifkan → perilaku lama (satu jurnal per transaksi).
 */
export async function getDailyJournalSince(
  outletId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, outletId))
    .limit(1);
  const settings = row?.settings as {
    features?: { dailyJournalSince?: unknown };
  } | null;
  const raw = settings?.features?.dailyJournalSince;
  return typeof raw === "string" && DATE_RE.test(raw) ? raw : null;
}
