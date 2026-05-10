export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string };
    };

export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success;
}

export interface ResetMockupResult {
  /** Per-table delete count untuk audit + UI confirmation. */
  counts: Record<string, number>;
  totalDeleted: number;
}
