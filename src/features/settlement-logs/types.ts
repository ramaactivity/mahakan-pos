import type { InferSelectModel } from "drizzle-orm";
import type { settlementLogs } from "@/db/schema";

export type SettlementLog = InferSelectModel<typeof settlementLogs>;
export type SettlementChannel = SettlementLog["channel"];

export const SETTLEMENT_CHANNELS: ReadonlyArray<SettlementChannel> = [
  "cash",
  "qris",
  "card_bca",
  "card_bni",
  "card_mandiri",
  "card_bri",
  "card_other",
  "gofood",
  "grabfood",
  "shopeefood",
] as const;

export const CHANNEL_LABEL: Record<SettlementChannel, string> = {
  cash: "Tunai",
  qris: "QRIS",
  card_bca: "EDC BCA",
  card_bni: "EDC BNI",
  card_mandiri: "EDC Mandiri",
  card_bri: "EDC BRI",
  card_other: "EDC Lainnya",
  gofood: "GoFood",
  grabfood: "GrabFood",
  shopeefood: "ShopeeFood",
};

export interface UpsertSettlementLogInput {
  settlementDate: string; // YYYY-MM-DD
  channel: SettlementChannel;
  expectedAmount: number;
  actualAmount: number;
  notes?: string | null;
}

export interface ListSettlementLogsOptions {
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  channel?: SettlementChannel;
  /** Default 100. */
  limit?: number;
}

/** Variance row at read time — combines persisted log + computed variance. */
export interface SettlementLogRow extends SettlementLog {
  variance: number; // actual - expected
  variancePct: number; // |actual - expected| / max(expected, 1)
}

/** Row untuk display — include channel label + edit state hooks. */
export interface ChannelSettlementRow {
  channel: SettlementChannel;
  label: string;
  expected: number;
  /** NULL kalau belum di-input (no log row). */
  log: SettlementLogRow | null;
}

export interface DailySettlementCrudReport {
  date: string;
  rows: ChannelSettlementRow[];
  totals: {
    expected: number;
    actual: number;
    variance: number;
  };
}

export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}

export function fail(
  code: string,
  message: string,
  field?: string,
): ApiResult<never> {
  return { success: false, error: { code, message, field } };
}

export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

/**
 * Variance threshold tier (Phase 6.1 default 1% / 5%).
 * - "match"   : within 1%
 * - "warn"    : 1% – 5%
 * - "alert"   : > 5% atau opposite-sign besar
 */
export type VarianceTier = "match" | "warn" | "alert";

export function classifyVariance(row: SettlementLogRow): VarianceTier {
  if (row.expectedAmount === 0 && row.actualAmount === 0) return "match";
  const pct = row.variancePct;
  if (pct <= 0.01) return "match";
  if (pct <= 0.05) return "warn";
  return "alert";
}
