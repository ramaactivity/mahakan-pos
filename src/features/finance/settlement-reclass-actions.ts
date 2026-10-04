"use server";

import { and, eq, gte, inArray, lte, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountingPeriods,
  aggregatorSettlements,
  chartOfAccounts,
  journalEntries,
  journalLines,
  outlets,
  settlementRevisions,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { recordJournal } from "@/features/accounting/posting";
import {
  resolveSettlementBankCode,
  SETTLEMENT_CHANNEL_LABEL,
  type AggregatorChannel,
} from "@/features/accounting/mapping/aggregatorSettlement";
import { fail, ok, type ApiResult } from "@/features/accounting/types";
import { subtractAlreadyMoved } from "./settlement-reclass-pure";

/**
 * Sesi AE-219 — PINDAH REKENING jurnal settlement yang terlanjur salah.
 *
 * Kejadian nyata: QRIS Mahakan cair ke BNI, tapi 98 jurnal settlement
 * (Rp 60,5 juta) mendebit Bank BCA karena tujuannya dulu ditebak dari nama
 * channel. Tidak ada error yang muncul — cuma saldo BCA yang membengkak dan
 * saldo BNI yang kurang, sampai rekening korannya dicocokkan.
 *
 * KENAPA REKLASIFIKASI, BUKAN BATAL-DAN-POSTING-ULANG SATU PER SATU:
 * membalik 98 jurnal lalu memposting ulang 98 penggantinya meninggalkan
 * hampir 300 entry di Buku Besar untuk memperbaiki satu kolom yang salah,
 * dan tiap pembalik harus mendarat di periodenya sendiri — beberapa di
 * antaranya sudah tutup buku. Reklasifikasi memindahkan saldonya apa adanya:
 * satu jurnal per BULAN, Dr rekening yang benar / Cr rekening yang salah,
 * sebesar yang benar-benar mendarat di sana bulan itu. Saldo tiap bulan jadi
 * benar, jejaknya terbaca sebagai satu baris yang menjelaskan dirinya
 * sendiri, dan jurnal settlement aslinya tidak diusik.
 *
 * Yang TIDAK dilakukan di sini: mengubah jurnal settlement lama. Kalau nanti
 * ada yang menelusuri satu settlement, dia tetap melihat rekening lama di
 * jurnal aslinya plus jurnal reklasifikasinya — itu memang yang terjadi.
 */

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

const MONTH_NAMES = [
  "",
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_NAMES[m]} ${y}`;
}

/** Hari terakhir bulan YYYY-MM (WIB, tanpa pergeseran zona). */
function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, "0")}`;
}

export type SettlementReclassRow = {
  month: string;
  monthLabel: string;
  /** Kode akun yang terlanjur didebit jurnal settlement bulan itu. */
  fromCode: string;
  fromName: string;
  amount: number;
  entryCount: number;
  /** Tanggal jurnal reklasifikasi yang akan dibuat. */
  postingDate: string;
  periodStatus: "open" | "closed" | "locked" | "belum ada";
  /** Terisi = baris ini tidak akan diposting. */
  blockedReason: string | null;
};

export type SettlementReclassPreview = {
  channel: AggregatorChannel;
  channelLabel: string;
  toCode: string;
  toName: string;
  rows: SettlementReclassRow[];
  totalAmount: number;
  postableAmount: number;
  /** Rekening tujuan yang BERLAKU untuk settlement baru (dari pengaturan). */
  configuredCode: string;
};

async function loadTargetAccount(outletId: string, code: string) {
  const [acc] = await db
    .select({
      code: chartOfAccounts.code,
      name: chartOfAccounts.name,
      type: chartOfAccounts.type,
      isActive: chartOfAccounts.isActive,
    })
    .from(chartOfAccounts)
    .where(
      and(eq(chartOfAccounts.outletId, outletId), eq(chartOfAccounts.code, code)),
    )
    .limit(1);
  return acc ?? null;
}

/**
 * Rincian per bulan: berapa yang mendarat di rekening mana untuk channel ini,
 * dalam rentang tanggal yang dipilih. Dipakai pratinjau DAN posting supaya
 * angka yang dilihat owner tidak mungkin beda dengan yang diposting.
 */
async function collectReclassRows(
  outletId: string,
  channel: AggregatorChannel,
  from: string,
  to: string,
  toCode: string,
): Promise<SettlementReclassRow[]> {
  /* Jurnal settlement channel ini: sourceId = id baris settlement.
   *
   * Sesi AE-249 — settlement yang sudah punya REVISI berlaku dikeluarkan.
   * Revisi sudah menentukan sendiri rekening tujuan settlement itu, per hari,
   * dari mutasi m-banking. Kalau pemindahan per BULAN ikut menggeretnya lagi,
   * uang yang sama berpindah dua kali — jurnalnya tetap seimbang, jadi tidak
   * ada yang terlihat rusak sampai saldo banknya dibandingkan dengan bank.
   * (Terjadi di September 2026: 23 settlement, Bank BCA jadi minus.) */
  const settlementIds = await db
    .select({ id: aggregatorSettlements.id })
    .from(aggregatorSettlements)
    .where(
      and(
        eq(aggregatorSettlements.outletId, outletId),
        eq(aggregatorSettlements.channel, channel),
        notExists(
          db
            .select({ one: sql`1` })
            .from(settlementRevisions)
            .where(
              and(
                eq(settlementRevisions.settlementId, aggregatorSettlements.id),
                eq(settlementRevisions.status, "posted"),
              ),
            ),
        ),
      ),
    );
  if (settlementIds.length === 0) return [];

  const rows = await db
    .select({
      month: sql<string>`to_char(${journalEntries.entryDate}, 'YYYY-MM')`,
      code: chartOfAccounts.code,
      name: chartOfAccounts.name,
      amount: sql<number>`SUM(${journalLines.debit})::bigint`,
      entries: sql<number>`COUNT(DISTINCT ${journalEntries.id})::int`,
    })
    .from(journalEntries)
    .innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(
      chartOfAccounts,
      eq(chartOfAccounts.id, journalLines.accountId),
    )
    .where(
      and(
        eq(journalEntries.outletId, outletId),
        eq(journalEntries.sourceType, "aggregator_settlement"),
        eq(journalEntries.status, "posted"),
        inArray(
          journalEntries.sourceId,
          settlementIds.map((s) => s.id),
        ),
        gte(journalEntries.entryDate, from),
        lte(journalEntries.entryDate, to),
        sql`${journalLines.debit} > 0`,
        eq(chartOfAccounts.type, "asset"),
        /* Hanya sisi kas/bank; baris biaya MDR (6402) bukan urusan pindah
         * rekening. Akun kas/bank Mahakan semuanya 11xx. */
        sql`${chartOfAccounts.code} LIKE '11%'`,
      ),
    )
    .groupBy(
      sql`to_char(${journalEntries.entryDate}, 'YYYY-MM')`,
      chartOfAccounts.code,
      chartOfAccounts.name,
    )
    .orderBy(sql`to_char(${journalEntries.entryDate}, 'YYYY-MM')`);

  /* Status periode tiap bulan tujuan posting. */
  const periods = await db
    .select({
      year: accountingPeriods.periodYear,
      month: accountingPeriods.periodMonth,
      status: accountingPeriods.status,
    })
    .from(accountingPeriods)
    .where(eq(accountingPeriods.outletId, outletId));
  const periodByYm = new Map(
    periods.map((p) => [
      `${p.year}-${String(p.month).padStart(2, "0")}`,
      p.status,
    ]),
  );

  /* Sesi AE-246 — REM ANTI-DOBEL. Reklasifikasi yang sudah pernah diposting
   * tidak terbaca oleh query di atas: jurnalnya ber-sourceType
   * 'settlement_reclass', sedangkan yang dihitung cuma 'aggregator_settlement'
   * — dan jurnal settlement aslinya memang sengaja tidak pernah diubah. Tanpa
   * pengurangan ini, menjalankan rentang yang memuat bulan yang sudah pindah
   * akan memindahkannya SEKALI LAGI: saldonya bergeser dua kali lipat tanpa
   * satu pun jurnal yang timpang, jadi tidak ada yang kelihatan rusak.
   * (Nyaris terjadi: Mei–Juli sudah dipindah, Agustus belum.) */
  const alreadyMoved = await db
    .select({
      month: sql<string>`${journalEntries.metadata} -> 'settlement_reclass' ->> 'month'`,
      fromCode: sql<string>`${journalEntries.metadata} -> 'settlement_reclass' ->> 'fromCode'`,
      amount: sql<number>`SUM(${journalLines.debit})::bigint`,
    })
    .from(journalEntries)
    .innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.outletId, outletId),
        eq(journalEntries.sourceType, "settlement_reclass"),
        eq(journalEntries.status, "posted"),
        eq(chartOfAccounts.code, toCode),
        sql`${journalLines.debit} > 0`,
        sql`${journalEntries.metadata} -> 'settlement_reclass' ->> 'channel' = ${channel}`,
      ),
    )
    .groupBy(
      sql`${journalEntries.metadata} -> 'settlement_reclass' ->> 'month'`,
      sql`${journalEntries.metadata} -> 'settlement_reclass' ->> 'fromCode'`,
    );
  const movedByKey = new Map(
    alreadyMoved
      .filter((m) => m.month && m.fromCode)
      .map((m) => [`${m.month}|${m.fromCode}`, Number(m.amount)]),
  );

  return subtractAlreadyMoved(
    rows
      .filter((r) => r.code !== toCode) // yang sudah benar tidak perlu dipindah
      .map((r) => ({ ...r, amount: Number(r.amount) })),
    movedByKey,
  )
    .map((r) => {
      const postingDate = lastDayOfMonth(r.month);
      const status = periodByYm.get(r.month) ?? null;
      let blocked: string | null = null;
      if (status === "locked") {
        blocked = `Periode ${monthLabel(r.month)} terkunci — buka dulu di Akuntansi → Periode.`;
      } else if (status === "closed") {
        blocked = `Periode ${monthLabel(r.month)} sudah tutup buku — buka dulu kalau mau dipindah.`;
      }
      return {
        month: r.month,
        monthLabel: monthLabel(r.month),
        fromCode: r.code,
        fromName: r.name,
        amount: Number(r.amount),
        entryCount: Number(r.entries),
        postingDate,
        periodStatus: (status ?? "belum ada") as SettlementReclassRow["periodStatus"],
        blockedReason: blocked,
      };
    });
}

export async function previewSettlementBankReclass(input: {
  channel: AggregatorChannel;
  from: string;
  to: string;
  toCode: string;
}): Promise<ApiResult<SettlementReclassPreview>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.journal.post")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat memindah rekening jurnal");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) {
    return fail("VALIDATION", "Rentang tanggal belum diisi dengan benar.");
  }
  if (input.from > input.to) {
    return fail("VALIDATION", "Tanggal awal melewati tanggal akhir.");
  }

  const target = await loadTargetAccount(session.user.outletId, input.toCode);
  if (!target) return fail("VALIDATION", `Akun ${input.toCode} tidak ada.`);
  if (!target.isActive) {
    return fail("VALIDATION", `Akun ${target.code} ${target.name} non-aktif.`);
  }
  if (target.type !== "asset") {
    return fail(
      "VALIDATION",
      `Akun ${target.code} ${target.name} bukan akun aset — tujuan harus kas/bank.`,
    );
  }

  const rows = await collectReclassRows(
    session.user.outletId,
    input.channel,
    input.from,
    input.to,
    target.code,
  );

  const [outletRow] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);

  return ok({
    channel: input.channel,
    channelLabel: SETTLEMENT_CHANNEL_LABEL[input.channel],
    toCode: target.code,
    toName: target.name,
    rows,
    totalAmount: rows.reduce((s, r) => s + r.amount, 0),
    postableAmount: rows
      .filter((r) => r.blockedReason === null)
      .reduce((s, r) => s + r.amount, 0),
    configuredCode: resolveSettlementBankCode(
      input.channel,
      outletRow?.settings?.cashless?.bankAccountByChannel,
    ),
  });
}

export async function postSettlementBankReclass(input: {
  channel: AggregatorChannel;
  from: string;
  to: string;
  toCode: string;
  reason: string;
}): Promise<
  ApiResult<{
    posted: Array<{ month: string; amount: number; entryNumber: string }>;
    skipped: Array<{ month: string; reason: string }>;
    totalMoved: number;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.journal.post")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat memindah rekening jurnal");
  }
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) {
    return fail(
      "VALIDATION",
      "Alasan pemindahan minimal 10 karakter — ini yang dibaca saat rekening koran dicocokkan nanti.",
    );
  }

  const preview = await previewSettlementBankReclass(input);
  if (!preview.ok) return preview as ApiResult<never>;
  const { rows, toCode, toName, channelLabel } = preview.data;
  if (rows.length === 0) {
    return fail(
      "NO_CHANGE",
      "Tidak ada jurnal settlement yang perlu dipindah di rentang itu.",
    );
  }

  const posted: Array<{ month: string; amount: number; entryNumber: string }> = [];
  const skipped: Array<{ month: string; reason: string }> = [];
  let totalMoved = 0;

  for (const row of rows) {
    if (row.blockedReason) {
      skipped.push({ month: row.month, reason: row.blockedReason });
      continue;
    }
    if (row.amount <= 0) {
      skipped.push({ month: row.month, reason: "Nilainya nol." });
      continue;
    }
    try {
      const result = await recordJournal({
        outletId: session.user.outletId,
        entryDate: row.postingDate,
        description: `Pindah rekening settlement ${channelLabel} ${row.monthLabel}: ${row.fromCode} → ${toCode}`,
        sourceType: "settlement_reclass",
        sourceId: null,
        lines: [
          {
            accountCode: toCode,
            debit: row.amount,
            description: `Settlement ${channelLabel} ${row.monthLabel} masuk ke ${toName}`,
          },
          {
            accountCode: row.fromCode,
            credit: row.amount,
            description: `Koreksi: bukan ke ${row.fromName} (${row.entryCount} settlement)`,
          },
        ],
        actorId: session.user.id,
        metadata: {
          settlement_reclass: {
            channel: input.channel,
            month: row.month,
            fromCode: row.fromCode,
            toCode,
            entryCount: row.entryCount,
            reason,
          },
        },
      });
      posted.push({
        month: row.month,
        amount: row.amount,
        entryNumber: result.entryNumber,
      });
      totalMoved += row.amount;
    } catch (e) {
      skipped.push({
        month: row.month,
        reason: logAndSanitize(e, "finance", "Jurnal gagal dibuat"),
      });
    }
  }

  await logAudit({
    eventType: "aggregator_settlement.bank_reclass",
    userId: session.user.id,
    entityType: "outlet",
    entityId: session.user.outletId,
    payload: {
      summary: `Pindah rekening settlement ${channelLabel} → ${toCode} ${toName}: ${posted.length} bulan, total Rp ${totalMoved.toLocaleString("id-ID")}`,
      context: {
        channel: input.channel,
        from: input.from,
        to: input.to,
        toCode,
        posted,
        skipped,
        reason,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit settlement.bank_reclass]", e));

  return ok({ posted, skipped, totalMoved });
}
