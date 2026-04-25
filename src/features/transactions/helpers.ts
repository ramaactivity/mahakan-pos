/**
 * Helpers for transaction number generation and WIB-day boundary handling.
 *
 * The business runs on Asia/Jakarta time. A "transaction day" runs from
 * 00:00 to 24:00 WIB; `transaction_number` sequence resets at 00:00 WIB.
 */

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** YYYYMMDD string of the current moment, computed in WIB. */
export function todayWibYmd(at: Date = new Date()): string {
  const wib = new Date(at.getTime() + WIB_OFFSET_MS);
  const yyyy = wib.getUTCFullYear();
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/** UTC instant corresponding to 00:00 WIB on the given moment's WIB date. */
export function startOfWibDayUtc(at: Date = new Date()): Date {
  const wib = new Date(at.getTime() + WIB_OFFSET_MS);
  // Build "today 00:00 WIB" then subtract WIB offset to get UTC
  const startWib = Date.UTC(
    wib.getUTCFullYear(),
    wib.getUTCMonth(),
    wib.getUTCDate(),
  );
  return new Date(startWib - WIB_OFFSET_MS);
}

export function endOfWibDayUtc(at: Date = new Date()): Date {
  return new Date(startOfWibDayUtc(at).getTime() + 24 * 60 * 60 * 1000);
}

/** Format TRX-YYYYMMDD-NNNN with the given sequence (4-digit zero-padded). */
export function formatTransactionNumber(
  ymd: string,
  sequence: number,
): string {
  const seq = String(sequence).padStart(4, "0");
  return `TRX-${ymd}-${seq}`;
}
