/**
 * Sesi AE-80 follow-up — pure dedup helper untuk bulk-import CSV.
 *
 * Goal: tiap row CSV di-classify jadi insert/upsert/skip berdasarkan
 * pre-fetched existing investor map (by NIK + by name). Pure function
 * supaya bisa di-unit-test tanpa DB.
 *
 * Pattern juga di-extract supaya investor/pengelola/kreditur importer
 * bisa reuse logic dedup yang sama (consistent semantic).
 */

export type DedupMode = "insert_only" | "upsert";

export interface DedupInputRow {
  rowIdx: number;
  fullName: string;
  /** NIK optional — kalau di-set, prioritas match dibanding fullName. */
  nik?: string | null;
}

export interface DedupExistingEntry {
  id: string;
  fullName: string;
  nik: string | null;
}

export interface DedupResult<T extends DedupInputRow> {
  /** Rows that should be inserted (new). */
  toInsert: T[];
  /** Rows that should update existing (matched + mode='upsert'). */
  toUpsert: Array<T & { existingId: string }>;
  /** Rows skipped because match existed + mode='insert_only'. */
  skippedDuplicate: number;
}

/**
 * Classify rows berdasarkan match terhadap existing entries.
 *
 * Match priority:
 *  1. By NIK (kalau row.nik set + ada di existingByNik)
 *  2. By fullName (case-insensitive trimmed)
 *
 * Internal dedup: kalau CSV punya 2 row dengan NIK / fullName sama,
 * row ke-2 dianggap PENDING duplikat (skip atau upsert sesuai mode).
 * Ini protect dari CSV bermasalah yang punya entries duplikat internal.
 */
export function classifyBulkImportRows<T extends DedupInputRow>(
  rows: T[],
  existing: DedupExistingEntry[],
  mode: DedupMode,
): DedupResult<T> {
  const existingByNik = new Map<string, string>();
  const existingByName = new Map<string, string>();
  for (const e of existing) {
    if (e.nik) existingByNik.set(e.nik, e.id);
    existingByName.set(e.fullName.trim().toLowerCase(), e.id);
  }

  const result: DedupResult<T> = {
    toInsert: [],
    toUpsert: [],
    skippedDuplicate: 0,
  };

  /* Sentinel untuk internal-CSV duplicate detection. */
  const PENDING = "__PENDING_INSERT__";

  for (const r of rows) {
    const nikMatch = r.nik ? existingByNik.get(r.nik) : undefined;
    const nameMatch = existingByName.get(r.fullName.trim().toLowerCase());
    const matched = nikMatch ?? nameMatch;

    if (matched) {
      if (matched === PENDING) {
        /* Internal CSV duplicate — counts as duplicate skip regardless of
         * mode (avoid double-insert of same row). */
        result.skippedDuplicate += 1;
        continue;
      }
      if (mode === "upsert") {
        result.toUpsert.push({ ...r, existingId: matched });
      } else {
        result.skippedDuplicate += 1;
      }
      continue;
    }

    /* Mark PENDING_INSERT untuk catch CSV-internal duplicates di
     * baris berikutnya. */
    if (r.nik) existingByNik.set(r.nik, PENDING);
    existingByName.set(r.fullName.trim().toLowerCase(), PENDING);
    result.toInsert.push(r);
  }

  return result;
}

/**
 * Compute capital_movements adjustment trail untuk rows yang punya
 * dividendBalance update saat upsert.
 *
 * Return only entries where balance changed (delta != 0). Used by
 * caller untuk insert capital_movements kind='adjustment'.
 */
export interface BalanceAdjustmentRow {
  holderId: string;
  delta: number;
  newBalance: number;
}

export function computeBalanceAdjustments(
  upsertResults: Array<{
    existingId: string;
    oldBalance: number;
    newBalance: number | null | undefined;
  }>,
): BalanceAdjustmentRow[] {
  return upsertResults
    .filter(
      (u): u is { existingId: string; oldBalance: number; newBalance: number } =>
        typeof u.newBalance === "number",
    )
    .map((u) => ({
      holderId: u.existingId,
      delta: u.newBalance - u.oldBalance,
      newBalance: u.newBalance,
    }))
    .filter((r) => r.delta !== 0);
}
