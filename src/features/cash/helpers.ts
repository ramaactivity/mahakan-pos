/** YYYY-MM-DD string for the current moment in WIB (Asia/Jakarta). */
export function todayWibIso(at: Date = new Date()): string {
  const wib = new Date(at.getTime() + 7 * 60 * 60 * 1000);
  const yyyy = wib.getUTCFullYear();
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** UTC instant at 00:00 WIB on the given YYYY-MM-DD date. */
export function startOfWibDateUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 7 * 60 * 60 * 1000);
}

export function endOfWibDateUtc(ymd: string): Date {
  return new Date(startOfWibDateUtc(ymd).getTime() + 24 * 60 * 60 * 1000);
}
