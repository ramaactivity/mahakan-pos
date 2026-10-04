"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aggregatorSettlements,
  chartOfAccounts,
  journalEntries,
  journalLines,
  settlementRevisions,
  users,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { recordJournal } from "@/features/accounting/posting";
import {
  mapSettlementRevision,
  reverseSettlementRevisionLines,
} from "@/features/accounting/mapping/settlementRevision";
import { SETTLEMENT_CHANNEL_LABEL } from "@/features/accounting/mapping/aggregatorSettlement";
import type { AggregatorChannel } from "@/features/accounting/mapping/aggregatorSettlement";
import { fail, ok, type ApiResult } from "@/features/accounting/types";

/**
 * Sesi AE-246 — REVISI SETTLEMENT per hari.
 *
 * Angka settlement yang dihitung sistem dari transaksi POS tidak selalu sama
 * dengan uang yang benar-benar masuk, dan rekening penerimanya bisa berbeda
 * dalam satu bulan (Mandiri dan BNI). Di sini owner mencatat apa yang
 * sebenarnya terjadi; jurnal penyeimbangnya dibuat otomatis.
 *
 * Jurnal settlement aslinya TIDAK diubah — lihat alasannya di
 * `db/schema/settlement_revisions.ts`.
 */

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

const CAN_REVISE = "accounting.journal.post" as const;

export interface SettlementRevisionRow {
  id: string;
  settlementId: string;
  entryDate: string;
  recordedAmount: number;
  recordedAccountCode: string;
  actualAmount: number;
  actualAccountCode: string;
  diffAmount: number;
  reason: string;
  status: "posted" | "reversed";
  createdByName: string | null;
  createdAt: string;
}

/**
 * Rekening & nilai yang BENAR-BENAR tercatat di jurnal settlement ini.
 *
 * Dibaca dari jurnalnya, bukan diturunkan ulang dari pengaturan channel:
 * pengaturan bisa sudah berubah sejak jurnal itu dibuat, dan yang perlu
 * dikeluarkan dari rekening lama adalah nilai yang memang mendarat di sana.
 */
async function readPostedBankLine(
  outletId: string,
  settlementId: string,
  channel: string,
): Promise<{
  code: string;
  amount: number;
  /** Kode di jurnal ASLI, kalau saldonya sudah dipindah lewat Pindah Rekening. */
  movedFromCode: string | null;
} | null> {
  const rows = await db
    .select({
      code: chartOfAccounts.code,
      month: sql<string>`to_char(${journalEntries.entryDate}, 'YYYY-MM')`,
      amount: sql<number>`SUM(${journalLines.debit})::bigint`,
    })
    .from(journalEntries)
    .innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.outletId, outletId),
        eq(journalEntries.sourceType, "aggregator_settlement"),
        eq(journalEntries.sourceId, settlementId),
        eq(journalEntries.status, "posted"),
        sql`${journalLines.debit} > 0`,
        eq(chartOfAccounts.type, "asset"),
        sql`${chartOfAccounts.code} LIKE '11%'`,
      ),
    )
    .groupBy(
      chartOfAccounts.code,
      sql`to_char(${journalEntries.entryDate}, 'YYYY-MM')`,
    );

  if (rows.length === 0) return null;
  /* Lebih dari satu rekening pada satu settlement tidak pernah dibuat oleh
   * jalur mana pun; kalau toh terjadi, menebak salah satunya akan mengarang
   * angka. Ditolak supaya ditangani manual. */
  if (rows.length > 1) return null;
  const original = rows[0]!;

  /**
   * Sesi AE-249 — ikuti Pindah Rekening.
   *
   * Pindah Rekening SENGAJA tidak mengubah jurnal settlement aslinya, jadi
   * jurnal itu selamanya menunjuk rekening lama. Kalau revisi berangkat dari
   * sana, ia akan memindahkan uang yang SUDAH dipindah — bergeser dua kali,
   * dan karena jurnalnya tetap seimbang tidak ada yang terlihat rusak.
   * (Terjadi di September 2026: Bank BCA jadi minus Rp 150.230 dari aktivitas
   * settlement saja, padahal settlement cuma menambah.)
   *
   * Yang benar: titik berangkat revisi adalah rekening tempat saldonya
   * SEKARANG, yaitu tujuan pemindahan terakhir untuk bulan + channel ini.
   */
  let code = original.code;
  let movedFromCode: string | null = null;
  for (let hop = 0; hop < 5; hop += 1) {
    const [moved] = await db
      .select({
        toCode: sql<string>`${journalEntries.metadata} -> 'settlement_reclass' ->> 'toCode'`,
      })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.outletId, outletId),
          eq(journalEntries.sourceType, "settlement_reclass"),
          eq(journalEntries.status, "posted"),
          sql`${journalEntries.metadata} -> 'settlement_reclass' ->> 'channel' = ${channel}`,
          sql`${journalEntries.metadata} -> 'settlement_reclass' ->> 'month' = ${original.month}`,
          sql`${journalEntries.metadata} -> 'settlement_reclass' ->> 'fromCode' = ${code}`,
        ),
      )
      .limit(1);
    if (!moved?.toCode || moved.toCode === code) break;
    movedFromCode = movedFromCode ?? original.code;
    code = moved.toCode;
    /* Dirantai: bulan yang sama bisa dipindah lebih dari sekali (1110 → 1113
     * → 1112, persis yang terjadi untuk QRIS September). Dibatasi 5 lompatan
     * supaya data yang melingkar tidak menggantung permintaannya. */
  }

  return { code, amount: Number(original.amount), movedFromCode };
}

/** Revisi yang masih berlaku untuk sekumpulan settlement (untuk badge list). */
export async function listSettlementRevisions(
  settlementIds: string[],
): Promise<ApiResult<SettlementRevisionRow[]>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi berakhir, silakan login ulang");
  if (settlementIds.length === 0) return ok([]);

  const rows = await db
    .select({ r: settlementRevisions, createdByName: users.name })
    .from(settlementRevisions)
    .leftJoin(users, eq(users.id, settlementRevisions.createdBy))
    .where(
      and(
        eq(settlementRevisions.outletId, session.user.outletId),
        inArray(settlementRevisions.settlementId, settlementIds),
      ),
    )
    .orderBy(desc(settlementRevisions.createdAt));

  return ok(
    rows.map((x) => ({
      id: x.r.id,
      settlementId: x.r.settlementId,
      entryDate: x.r.entryDate,
      recordedAmount: x.r.recordedAmount,
      recordedAccountCode: x.r.recordedAccountCode,
      actualAmount: x.r.actualAmount,
      actualAccountCode: x.r.actualAccountCode,
      diffAmount: x.r.diffAmount,
      reason: x.r.reason,
      status: x.r.status,
      createdByName: x.createdByName ?? null,
      createdAt: x.r.createdAt.toISOString(),
    })),
  );
}

/** Apa yang tercatat sekarang untuk satu settlement — isi awal form revisi. */
export interface SettlementRevisionContext {
  settlementId: string;
  channelLabel: string;
  entryDate: string;
  /** Nilai yang BENAR-BENAR didebit jurnal settlement, bukan hitung ulang. */
  recordedAmount: number;
  recordedAccountCode: string;
  recordedAccountName: string;
  /**
   * Sesi AE-249 — kode di jurnal ASLI, kalau saldonya sudah dipindah lewat
   * Pindah Rekening. Layar menyebutnya supaya owner tidak bingung melihat
   * rekening yang berbeda dari jurnal settlement-nya.
   */
  movedFromCode: string | null;
  netAmount: number;
  /** Ada jurnal kas/bank berstatus posted yang bisa direvisi. */
  hasPostedJournal: boolean;
  /**
   * Sesi AE-248 — jurnal settlement-nya sendiri sudah DIBATALKAN. Beda dari
   * "belum pernah punya jurnal", dan bedanya penting: kalau revisinya masih
   * berlaku, jurnal revisi itu jadi yatim — menggeser saldo bank untuk
   * settlement yang sudah tidak ada. Owner harus bisa membatalkannya dari
   * sini, jadi konteksnya tetap dikembalikan, bukan ditolak mentah.
   */
  journalReversed: boolean;
  alreadyRevised: boolean;
  /** Revisi yang masih berlaku — supaya layar bisa menawarkan pembatalan. */
  activeRevision: {
    id: string;
    actualAmount: number;
    actualAccountCode: string;
    recordedAmount: number;
    recordedAccountCode: string;
    reason: string;
  } | null;
}

export async function getSettlementRevisionContext(input: {
  settlementId: string;
}): Promise<ApiResult<SettlementRevisionContext>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, CAN_REVISE)) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat merevisi settlement");
  }

  const [s] = await db
    .select()
    .from(aggregatorSettlements)
    .where(eq(aggregatorSettlements.id, input.settlementId))
    .limit(1);
  if (!s) return fail("NOT_FOUND", "Settlement tidak ditemukan");
  if (s.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Settlement dari outlet lain");
  }

  const posted = await readPostedBankLine(session.user.outletId, s.id, s.channel);

  /* Jurnalnya ada tapi sudah dibatalkan? Itu keadaan yang berbeda dari belum
   * pernah ada, dan layar perlu mengatakannya dengan jujur. */
  const [reversedLine] = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, session.user.outletId),
        eq(journalEntries.sourceType, "aggregator_settlement"),
        eq(journalEntries.sourceId, s.id),
        eq(journalEntries.status, "reversed"),
      ),
    )
    .limit(1);

  const [account] = posted
    ? await db
        .select({ name: chartOfAccounts.name })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.outletId, session.user.outletId),
            eq(chartOfAccounts.code, posted.code),
          ),
        )
        .limit(1)
    : [undefined];

  const [active] = await db
    .select({
      id: settlementRevisions.id,
      actualAmount: settlementRevisions.actualAmount,
      actualAccountCode: settlementRevisions.actualAccountCode,
      recordedAmount: settlementRevisions.recordedAmount,
      recordedAccountCode: settlementRevisions.recordedAccountCode,
      reason: settlementRevisions.reason,
    })
    .from(settlementRevisions)
    .where(
      and(
        eq(settlementRevisions.settlementId, s.id),
        eq(settlementRevisions.status, "posted"),
      ),
    )
    .limit(1);

  return ok({
    settlementId: s.id,
    channelLabel:
      SETTLEMENT_CHANNEL_LABEL[s.channel as AggregatorChannel] ?? s.channel,
    entryDate: s.periodFrom,
    recordedAmount: posted?.amount ?? 0,
    recordedAccountCode: posted?.code ?? "",
    recordedAccountName: account?.name ?? posted?.code ?? "",
    movedFromCode: posted?.movedFromCode ?? null,
    netAmount: s.netAmount,
    hasPostedJournal: posted !== null,
    journalReversed: posted === null && Boolean(reversedLine),
    alreadyRevised: Boolean(active),
    activeRevision: active ?? null,
  });
}

export async function postSettlementRevision(input: {
  settlementId: string;
  actualAmount: number;
  actualAccountCode: string;
  reason: string;
}): Promise<ApiResult<{ id: string; journalEntryId: string; diffAmount: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, CAN_REVISE)) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat merevisi settlement");
  }

  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) {
    return fail(
      "VALIDATION",
      "Alasan revisi minimal 10 karakter — ini yang dibaca saat rekening koran dicocokkan nanti.",
    );
  }
  if (!Number.isInteger(input.actualAmount) || input.actualAmount < 0) {
    return fail("VALIDATION", "Nominal harus bilangan bulat rupiah");
  }

  const ctx = await getSettlementRevisionContext({
    settlementId: input.settlementId,
  });
  if (!ctx.ok) return ctx as ApiResult<never>;
  const ctxData = ctx.data;
  if (!ctxData.hasPostedJournal) {
    return fail(
      "NO_JOURNAL",
      ctxData.journalReversed
        ? "Jurnal settlement ini sudah dibatalkan, jadi tidak ada yang bisa direvisi. Buat ulang settlement-nya dulu kalau uangnya memang masuk."
        : "Settlement ini belum punya jurnal kas/bank yang bisa direvisi. Cek dulu di Antrian Jurnal.",
    );
  }
  if (ctxData.alreadyRevised) {
    return fail(
      "ALREADY_REVISED",
      "Settlement ini sudah punya revisi yang berlaku. Batalkan dulu revisi lamanya kalau mau diperbaiki lagi.",
    );
  }

  /* Rekening tujuan wajib ada di bagan akun outlet ini dan berupa kas/bank —
   * salah ketik kode akan membuat jurnal mendarat di akun yang tidak ada
   * hubungannya dengan uang. */
  const [target] = await db
    .select({ code: chartOfAccounts.code, name: chartOfAccounts.name })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.outletId, session.user.outletId),
        eq(chartOfAccounts.code, input.actualAccountCode),
        eq(chartOfAccounts.type, "asset"),
      ),
    )
    .limit(1);
  if (!target || !/^11\d{2}$/.test(target.code)) {
    return fail(
      "VALIDATION",
      "Rekening tujuan harus akun kas/bank (kode 11xx)",
    );
  }

  const label = `${ctxData.channelLabel} ${ctxData.entryDate}`;
  let lines;
  try {
    lines = mapSettlementRevision({
      recordedAmount: ctxData.recordedAmount,
      recordedAccountCode: ctxData.recordedAccountCode,
      actualAmount: input.actualAmount,
      actualAccountCode: target.code,
      label,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("NO_CHANGE")) {
      return fail(
        "NO_CHANGE",
        "Nominal dan rekeningnya sama persis dengan yang sudah tercatat — tidak ada yang perlu direvisi.",
      );
    }
    return fail("VALIDATION", logAndSanitize(e, "finance", "Jurnal revisi gagal disusun"));
  }

  const diffAmount = input.actualAmount - ctxData.recordedAmount;

  try {
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(settlementRevisions)
        .values({
          outletId: session.user.outletId,
          settlementId: ctxData.settlementId,
          entryDate: ctxData.entryDate,
          recordedAmount: ctxData.recordedAmount,
          recordedAccountCode: ctxData.recordedAccountCode,
          actualAmount: input.actualAmount,
          actualAccountCode: target.code,
          diffAmount,
          reason,
          createdBy: session.user.id,
        })
        .returning();

      const journal = await recordJournal({
        outletId: session.user.outletId,
        entryDate: ctxData.entryDate,
        description: `Revisi settlement ${label}: ${ctxData.recordedAccountCode} → ${target.code}`,
        sourceType: "settlement_revision",
        sourceId: row.id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: {
          settlement_revision: {
            settlementId: ctxData.settlementId,
            recordedAmount: ctxData.recordedAmount,
            recordedAccountCode: ctxData.recordedAccountCode,
            actualAmount: input.actualAmount,
            actualAccountCode: target.code,
            diffAmount,
            reason,
          },
        },
      });

      await tx
        .update(settlementRevisions)
        .set({ journalEntryId: journal.entryId })
        .where(eq(settlementRevisions.id, row.id));

      return { id: row.id, journalEntryId: journal.entryId };
    });

    logAudit({
      eventType: "aggregator_settlement.revision",
      userId: session.user.id,
      entityType: "aggregator_settlement",
      entityId: ctxData.settlementId,
      payload: {
        summary: `Revisi settlement ${label}: tercatat Rp ${ctxData.recordedAmount.toLocaleString("id-ID")} di ${ctxData.recordedAccountCode} → nyatanya Rp ${input.actualAmount.toLocaleString("id-ID")} di ${target.code}`,
        after: {
          actualAmount: input.actualAmount,
          actualAccountCode: target.code,
          diffAmount,
          reason,
        },
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    }).catch((e) => console.error("[audit settlement.revision]", e));

    return ok({ ...result, diffAmount });
  } catch (e) {
    return fail("DB_ERROR", logAndSanitize(e, "finance", "Revisi gagal disimpan"));
  }
}

/** Batalkan satu revisi — jurnalnya dibalik, barisnya ditandai reversed. */
export async function reverseSettlementRevision(input: {
  id: string;
  reason: string;
}): Promise<ApiResult<{ reversalEntryId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, CAN_REVISE)) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat membatalkan revisi");
  }
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) {
    return fail("VALIDATION", "Alasan pembatalan minimal 5 karakter");
  }

  const [row] = await db
    .select()
    .from(settlementRevisions)
    .where(eq(settlementRevisions.id, input.id))
    .limit(1);
  if (!row) return fail("NOT_FOUND", "Revisi tidak ditemukan");
  if (row.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Revisi dari outlet lain");
  }
  if (row.status === "reversed") {
    return fail("ALREADY_REVERSED", "Revisi ini sudah dibatalkan");
  }

  /* Baris jurnal disusun ulang dari JEPRETAN di baris revisi, bukan dihitung
   * ulang dari jurnal settlement: nilainya pasti sama persis dengan yang dulu
   * diposting, walaupun pengaturan rekening sudah berubah sejak itu. */
  const lines = reverseSettlementRevisionLines(
    mapSettlementRevision({
      recordedAmount: row.recordedAmount,
      recordedAccountCode: row.recordedAccountCode,
      actualAmount: row.actualAmount,
      actualAccountCode: row.actualAccountCode,
      label: `settlement ${row.entryDate}`,
    }),
  );

  try {
    const reversalEntryId = await db.transaction(async (tx) => {
      const journal = await recordJournal({
        outletId: session.user.outletId,
        entryDate: row.entryDate,
        description: `Pembalik revisi settlement ${row.entryDate} — ${reason}`,
        sourceType: "settlement_revision_reversal",
        sourceId: row.id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: { reversedRevisionId: row.id, reason },
      });

      await tx
        .update(settlementRevisions)
        .set({
          status: "reversed",
          reversedAt: new Date(),
          reversedBy: session.user.id,
          reversalReason: reason,
        })
        .where(eq(settlementRevisions.id, row.id));

      return journal.entryId;
    });

    logAudit({
      eventType: "aggregator_settlement.revision_reverse",
      userId: session.user.id,
      entityType: "aggregator_settlement",
      entityId: row.settlementId,
      payload: {
        summary: `Batalkan revisi settlement ${row.entryDate}: ${reason}`,
        after: { status: "reversed", reason },
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    }).catch((e) => console.error("[audit settlement.revision_reverse]", e));

    return ok({ reversalEntryId });
  } catch (e) {
    return fail("DB_ERROR", logAndSanitize(e, "finance", "Pembatalan gagal"));
  }
}

/**
 * Sesi AE-250 — POSTING ULANG jurnal settlement yang terlanjur dibatalkan.
 *
 * Latar: sebelum tombol "Batalkan Revisi" ada (AE-248), owner yang salah
 * merevisi membatalkan jurnal SETTLEMENT-nya. Settlement-nya sendiri masih
 * ada dan uangnya memang masuk, tapi jurnalnya hilang — piutangnya tidak
 * pernah dibersihkan dan saldo bank kurang sebesar itu. Tanpa jalan ini,
 * satu-satunya perbaikan adalah menghapus lalu membuat ulang settlement-nya,
 * yang membuang jejaknya.
 *
 * Jurnalnya disusun lewat `resolveSettlementJournalArgs` — jalur yang sama
 * dengan pembuatan otomatis, jadi rekening tujuan dan entry_date-nya tunduk
 * pada aturan yang sama persis.
 *
 * Catatan untuk yang membaca nanti: kalau settlement ini punya revisi yang
 * masih berlaku, jurnal revisinya SENGAJA dibiarkan. Revisi itu menggeser
 * saldo relatif terhadap jurnal settlement; begitu jurnalnya kembali,
 * pasangannya lengkap lagi dan hasil akhirnya persis seperti sebelum
 * pembatalan.
 */
export async function repostSettlementJournal(input: {
  settlementId: string;
  reason: string;
}): Promise<ApiResult<{ entryId: string; entryNumber: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, CAN_REVISE)) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat memposting ulang jurnal");
  }
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) {
    return fail(
      "VALIDATION",
      "Alasan posting ulang minimal 10 karakter — ini yang dibaca saat jurnalnya ditelusuri nanti.",
    );
  }

  const [s] = await db
    .select()
    .from(aggregatorSettlements)
    .where(eq(aggregatorSettlements.id, input.settlementId))
    .limit(1);
  if (!s) return fail("NOT_FOUND", "Settlement tidak ditemukan");
  if (s.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Settlement dari outlet lain");
  }

  /* Sudah punya jurnal yang hidup? Jangan buat yang kedua — piutangnya akan
   * dibersihkan dua kali dan saldo banknya naik dua kali lipat. */
  const existing = await readPostedBankLine(
    session.user.outletId,
    s.id,
    s.channel,
  );
  if (existing) {
    return fail(
      "ALREADY_POSTED",
      "Settlement ini sudah punya jurnal yang berlaku. Tidak perlu diposting ulang.",
    );
  }

  const { resolveSettlementJournalArgs } = await import("./settlement-generate");
  const { postJournalForAggregatorSettlement } = await import(
    "@/features/accounting/hooks"
  );

  try {
    /* Diposting SINKRON, bukan lewat fireJournalHook: ini tombol yang ditekan
     * owner dan menunggu jawabannya. Fire-and-forget akan menjawab "berhasil"
     * walau jurnalnya gagal dibuat — persis kegagalan yang pernah membuat 682
     * jurnal hilang diam-diam. */
    const args = await resolveSettlementJournalArgs(
      s,
      session.user.id,
      session.user.outletId,
    );
    await postJournalForAggregatorSettlement(args);

    const posted = await readPostedBankLine(
      session.user.outletId,
      s.id,
      s.channel,
    );
    if (!posted) {
      return fail(
        "NOT_POSTED",
        "Jurnal tidak terbentuk. Kemungkinan auto-jurnal sedang mati atau periodenya terkunci — cek Akuntansi → Periode.",
      );
    }

    const [entry] = await db
      .select({
        id: journalEntries.id,
        entryNumber: journalEntries.entryNumber,
      })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.outletId, session.user.outletId),
          eq(journalEntries.sourceType, "aggregator_settlement"),
          eq(journalEntries.sourceId, s.id),
          eq(journalEntries.status, "posted"),
        ),
      )
      .limit(1);

    logAudit({
      eventType: "aggregator_settlement.journal_repost",
      userId: session.user.id,
      entityType: "aggregator_settlement",
      entityId: s.id,
      payload: {
        summary: `Posting ulang jurnal settlement ${s.channel} ${s.periodFrom}: Rp ${Number(s.netAmount).toLocaleString("id-ID")}`,
        after: { reason, entryNumber: entry?.entryNumber ?? null },
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    }).catch((e) => console.error("[audit settlement.journal_repost]", e));

    return ok({
      entryId: entry?.id ?? "",
      entryNumber: entry?.entryNumber ?? "",
    });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "finance", "Jurnal gagal diposting ulang"),
    );
  }
}
