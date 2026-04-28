/**
 * Resolves outlet ID for inventory import/export scripts. Auto-detects
 * single-outlet setups; supports `--outlet <uuid>` override.
 */
import { eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { outlets } from "@/db/schema";

export interface OutletResolution {
  outletId: string;
  outletName: string;
}

export async function resolveOutlet(
  override: string | undefined,
): Promise<OutletResolution> {
  if (override) {
    const [row] = await db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(eq(outlets.id, override))
      .limit(1);
    if (!row) {
      throw new Error(`Outlet override --outlet=${override} tidak ditemukan`);
    }
    return { outletId: row.id, outletName: row.name };
  }

  const rows = await db
    .select({ id: outlets.id, name: outlets.name })
    .from(outlets)
    .where(isNull(outlets.deletedAt));

  if (rows.length === 0) {
    throw new Error(
      "Tidak ada outlet di DB. Jalankan `npm run db:seed` dulu.",
    );
  }
  if (rows.length > 1) {
    const list = rows.map((r) => `  - ${r.id}  ${r.name}`).join("\n");
    throw new Error(
      `Multiple outlets ditemukan, pakai flag --outlet <uuid>:\n${list}`,
    );
  }
  return { outletId: rows[0].id, outletName: rows[0].name };
}
