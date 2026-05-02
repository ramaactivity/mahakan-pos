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
