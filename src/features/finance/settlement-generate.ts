import "server-only";

/**
 * Sesi AE-165 — core auto-settlement QRIS / EDC BCA dari POS.
 *
 * Dipisah dari actions.ts (`"use server"`) supaya fungsi internal yang
 * menerima outletId/createdBy TIDAK ke-expose sebagai server action publik
 * (security: tanpa auth, bisa di-panggil arbitrary). File ini server-only;
 * dipanggil dari:
 *   - actions.ts `generateCashlessSettlementFromPos` (session, auth) → manual
 *   - cron-jobs `runCashlessSettlementJob` → otomatis harian
 *
 * Juga rumah untuk `fireSettlementJournalHook` (dipakai bersama
 * createAggregatorSettlement). Hook no-op kalau auto-journal outlet OFF.
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { aggregatorSettlements, chartOfAccounts, outlets } from "@/db/schema";
import { logAudit } from "@/lib/audit/logger";
import { getPosCashlessGrossByDay, hasSettlementForDay } from "./queries";
import type { PosCashlessGross } from "./queries";
import type {
  AggregatorSettlement,
  CashlessMdrConfig,
  GenerateCashlessResult,
} from "./types";

const CHANNEL_LABEL: Record<string, string> = {
  qris: "QRIS",
  edc_bca: "EDC BCA",
  edc_bni: "EDC BNI",
  edc_bri: "EDC BRI",
  edc_other: "EDC Kartu Lainnya",
};

export const DEFAULT_MDR_QRIS_PCT = 0.7;
export const DEFAULT_MDR_EDC_BCA_PCT = 0;
/* Sesi AE-182 — MDR mesin EDC selain BCA. Default 0 (sama seperti BCA);
 * owner override lewat outlets.settings.cashless kalau bank menagih fee. */
export const DEFAULT_MDR_EDC_BNI_PCT = 0;
export const DEFAULT_MDR_EDC_BRI_PCT = 0;
export const DEFAULT_MDR_EDC_OTHER_PCT = 0;

/** Resolve rate MDR per channel untuk outletId (fallback default). */
export async function resolveMdrConfig(
  outletId: string,
): Promise<CashlessMdrConfig> {
  const [row] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, outletId))
    .limit(1);
  const c = row?.settings?.cashless;
  return {
    mdrQrisPct: c?.mdrQrisPct ?? DEFAULT_MDR_QRIS_PCT,
    mdrEdcBcaPct: c?.mdrEdcBcaPct ?? DEFAULT_MDR_EDC_BCA_PCT,
    mdrEdcBniPct: c?.mdrEdcBniPct ?? DEFAULT_MDR_EDC_BNI_PCT,
    mdrEdcBriPct: c?.mdrEdcBriPct ?? DEFAULT_MDR_EDC_BRI_PCT,
    mdrEdcOtherPct: c?.mdrEdcOtherPct ?? DEFAULT_MDR_EDC_OTHER_PCT,
  };
}

/** Enumerate tanggal WIB inclusive from..to (cap by caller). */
export function enumerateDatesIso(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    const d = new Date(`${cur}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    cur = d.toISOString().slice(0, 10);
  }
  return out;
}

/**
 * Fire auto-journal hook untuk satu settlement row. Resolve bankAccountCode
 * (kalau ada), entryDate, lalu fireJournalHook (fire-and-forget). Channel-aware
 * mapping ada di postJournalForAggregatorSettlement: QRIS/EDC clear piutang,
 * aggregator recognize revenue. No-op kalau auto-journal outlet OFF.
 */
export async function fireSettlementJournalHook(
  row: AggregatorSettlement,
  actorId: string,
  outletId: string,
): Promise<void> {
  const { fireJournalHook, postJournalForAggregatorSettlement } = await import(
    "@/features/accounting/hooks"
  );
  let bankAccountCode: string | null = null;
  if (row.bankAccountId) {
    const [bankAcc] = await db
      .select({ code: chartOfAccounts.code })
      .from(chartOfAccounts)
      .where(eq(chartOfAccounts.id, row.bankAccountId))
      .limit(1);
    bankAccountCode = bankAcc?.code ?? null;
  }
  /* Sesi AE-182 — fallback ke periodTo (hari settlement-nya), BUKAN hari ini.
   * Dulu pakai `new Date()`: untuk cron harian itu wajar (uang masuk bank
   * H+1), tapi begitu dipakai untuk mengejar backlog, settlement bulan Mei
   * mendarat di bulan berjalan dan merusak laporan DUA bulan sekaligus.
   * Bukti: backfill 2026-08-04 sempat menempatkan 46 jurnal settlement
   * (Rp 25,2jt) di Agustus padahal periodenya Mei–Juli. Aturan sekarang sama
   * persis dengan yang dipakai sapuan otomatis di accounting/auto-retry.ts. */
  const entryDate = row.bankCreditedAt
    ? new Date(row.bankCreditedAt).toISOString().slice(0, 10)
    : String(row.periodTo);
  fireJournalHook(
    () =>
      postJournalForAggregatorSettlement({
        outletId,
        settlementId: row.id,
        channel: row.channel,
        grossAmount: Number(row.grossAmount),
        feeAmount: Number(row.feeAmount),
        netAmount: Number(row.netAmount),
        bankAccountCode,
        periodFrom: String(row.periodFrom),
        periodTo: String(row.periodTo),
        entryDate,
        referenceNo: row.referenceNo,
        actorId,
      }),
    "aggregator_settlement",
  );
}

/* Dipakai agar import `and/gte/lte` tidak unused — reserved untuk filter masa
 * depan; saat ini dedup via hasSettlementForDay. */
void and;
void gte;
void lte;

/**
 * Core (no-session) — generate settlement QRIS & EDC BCA harian dari POS untuk
 * satu outlet + rentang tanggal. Dedup OVERLAP (skip hari yang sudah punya
 * settlement channel itu — termasuk CSV rentang). Fee = round(gross × MDR%).
 * Net = gross − fee. Insert source='auto_pos' + fire journal hook.
 *
 * IDEMPOTEN: aman dijalankan ulang (manual + cron) — hari yang sudah ada
 * settlement di-skip, jadi tidak dobel-post jurnal / dobel-clear piutang.
 */
export async function generateCashlessForOutlet(params: {
  outletId: string;
  createdBy: string;
  actorRole: string;
  from: string;
  to: string;
}): Promise<GenerateCashlessResult> {
  const { outletId, createdBy, actorRole, from, to } = params;
  const mdr = await resolveMdrConfig(outletId);
  const dates = enumerateDatesIso(from, to);
  /* Sesi AE-182 — semua mesin EDC ikut di-settle otomatis, bukan cuma BCA.
   * Sebelumnya piutang EDC BNI/BRI/Lainnya menumpuk tanpa pernah di-clear. */
  const channels: Array<{
    channel: "qris" | "edc_bca" | "edc_bni" | "edc_bri" | "edc_other";
    pct: number;
    pick: (g: PosCashlessGross) => number;
  }> = [
    { channel: "qris", pct: mdr.mdrQrisPct, pick: (g) => g.qris },
    { channel: "edc_bca", pct: mdr.mdrEdcBcaPct, pick: (g) => g.cardBca },
    { channel: "edc_bni", pct: mdr.mdrEdcBniPct, pick: (g) => g.cardBni },
    { channel: "edc_bri", pct: mdr.mdrEdcBriPct, pick: (g) => g.cardBri },
    {
      channel: "edc_other",
      pct: mdr.mdrEdcOtherPct,
      pick: (g) => g.cardOther,
    },
  ];

  const result: GenerateCashlessResult = {
    created: [],
    skipped: 0,
    daysScanned: dates.length,
  };

  for (const date of dates) {
    const gross = await getPosCashlessGrossByDay(outletId, date);
    for (const ch of channels) {
      const grossAmt = ch.pick(gross);
      if (grossAmt <= 0) continue; // tidak ada transaksi channel ini hari itu
      if (await hasSettlementForDay(outletId, ch.channel, date)) {
        result.skipped += 1;
        continue; // sudah ada settlement (CSV/auto) → jangan dobel
      }
      const fee = Math.round((grossAmt * ch.pct) / 100);
      const net = grossAmt - fee;
      const [inserted] = await db
        .insert(aggregatorSettlements)
        .values({
          outletId,
          channel: ch.channel,
          periodFrom: date,
          periodTo: date,
          grossAmount: grossAmt,
          feeAmount: fee,
          netAmount: net,
          source: "auto_pos",
          notes: `Auto dari POS (${CHANNEL_LABEL[ch.channel]})`,
          createdBy,
        })
        .returning();

      logAudit({
        eventType: "aggregator_settlement.auto_generate",
        userId: createdBy,
        entityType: "aggregator_settlement",
        entityId: inserted.id,
        payload: {
          summary: `Auto-settlement ${ch.channel} ${date}: gross Rp ${grossAmt.toLocaleString("id-ID")}, fee Rp ${fee.toLocaleString("id-ID")}`,
          after: inserted,
        },
        metadata: { outletId, actorRole },
      }).catch((e) =>
        console.error("[audit aggregator_settlement.auto_generate]", e),
      );

      await fireSettlementJournalHook(inserted, createdBy, outletId);
      result.created.push({
        channel: ch.channel,
        date,
        gross: grossAmt,
        fee,
        net,
      });
    }
  }
  return result;
}
