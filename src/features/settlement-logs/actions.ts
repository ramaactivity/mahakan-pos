"use server";

import { and, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  settlementLogs,
  splitPayments,
  transactions,
  users,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import {
  CHANNEL_LABEL,
  SETTLEMENT_CHANNELS,
  classifyVariance,
  fail,
  ok,
  type ApiResult,
  type ChannelSettlementRow,
  type DailySettlementCrudReport,
  type ListSettlementLogsOptions,
  type SettlementChannel,
  type SettlementLog,
  type SettlementLogRow,
  type UpsertSettlementLogInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

function dayBoundsUtc(dateIso: string): { gte: Date; lt: Date } {
  // settlementDate is WIB calendar day; transactions.createdAt is UTC.
  // WIB = UTC+7. Day boundary [00:00 WIB, 24:00 WIB) → UTC [date-1 17:00, date 17:00).
  const start = new Date(`${dateIso}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { gte: start, lt: end };
}

function computeRow(log: SettlementLog): SettlementLogRow {
  const expected = Number(log.expectedAmount);
  const actual = Number(log.actualAmount);
  const variance = actual - expected;
  const variancePct = expected > 0 ? Math.abs(variance) / expected : 0;
  return { ...log, variance, variancePct };
}

/**
 * Per-channel expected amount from POS (transactions + split_payments)
 * pada tanggal sale. Aggregator channels (gofood/grabfood/shopeefood) tidak
 * tracked di POS (no per-order entry); selalu return 0 untuk auto-expected
 * (owner input manual saat input mutasi bank).
 */
export async function getExpectedSettlementByChannel(
  dateIso: string,
): Promise<ApiResult<Record<SettlementChannel, number>>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "settlement_log.view")) {
    return fail("FORBIDDEN", "Tidak punya hak akses");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    return fail("INVALID_DATE", "Format tanggal harus YYYY-MM-DD");
  }

  const { gte: dayStart, lt: dayEnd } = dayBoundsUtc(dateIso);

  // Single-line trx group by payment_method, status='paid', exclude split
  // legs (split parents are paid but counted via splitPayments below).
  const trxAgg = await db
    .select({
      paymentMethod: transactions.paymentMethod,
      total: sql<string>`COALESCE(SUM(${transactions.total}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.outletId, session.user.outletId),
        eq(transactions.status, "paid"),
        gte(transactions.createdAt, dayStart),
        lt(transactions.createdAt, dayEnd),
      ),
    )
    .groupBy(transactions.paymentMethod);

  // Split payments — sum legs WHERE parent transaction is paid + same day.
  const splitAgg = await db
    .select({
      paymentMethod: splitPayments.paymentMethod,
      total: sql<string>`COALESCE(SUM(${splitPayments.amount}), 0)`,
    })
    .from(splitPayments)
    .innerJoin(transactions, eq(transactions.id, splitPayments.transactionId))
    .where(
      and(
        eq(splitPayments.outletId, session.user.outletId),
        eq(transactions.status, "paid"),
        gte(transactions.createdAt, dayStart),
        lt(transactions.createdAt, dayEnd),
      ),
    )
    .groupBy(splitPayments.paymentMethod);

  const result: Record<SettlementChannel, number> = {
    cash: 0,
    qris: 0,
    card_bca: 0,
    card_bni: 0,
    card_mandiri: 0,
    card_bri: 0,
    card_other: 0,
    gofood: 0,
    grabfood: 0,
    shopeefood: 0,
  };

  for (const r of trxAgg) {
    if (r.paymentMethod === "split") continue;
    if (r.paymentMethod in result) {
      result[r.paymentMethod as SettlementChannel] += Number(r.total);
    }
  }
  for (const r of splitAgg) {
    if (r.paymentMethod in result) {
      result[r.paymentMethod as SettlementChannel] += Number(r.total);
    }
  }

  return ok(result);
}

export async function listSettlementLogs(
  opts: ListSettlementLogsOptions = {},
): Promise<ApiResult<SettlementLogRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "settlement_log.view")) {
    return fail("FORBIDDEN", "Tidak punya hak akses");
  }

  const limit = opts.limit ?? 100;
  const conds = [
    eq(settlementLogs.outletId, session.user.outletId),
    isNull(settlementLogs.deletedAt),
  ];
  if (opts.from) conds.push(gte(settlementLogs.settlementDate, opts.from));
  if (opts.to) conds.push(lte(settlementLogs.settlementDate, opts.to));
  if (opts.channel) conds.push(eq(settlementLogs.channel, opts.channel));

  const rows = await db
    .select()
    .from(settlementLogs)
    .where(and(...conds))
    .orderBy(desc(settlementLogs.settlementDate), settlementLogs.channel)
    .limit(limit);

  return ok(rows.map(computeRow));
}

export async function getDailySettlementCrudReport(
  dateIso: string,
): Promise<ApiResult<DailySettlementCrudReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "settlement_log.view")) {
    return fail("FORBIDDEN", "Tidak punya hak akses");
  }

  const expectedRes = await getExpectedSettlementByChannel(dateIso);
  if (!expectedRes.success) return expectedRes;
  const expected = expectedRes.data;

  const logs = await db
    .select()
    .from(settlementLogs)
    .where(
      and(
        eq(settlementLogs.outletId, session.user.outletId),
        eq(settlementLogs.settlementDate, dateIso),
        isNull(settlementLogs.deletedAt),
      ),
    );
  const byChannel = new Map<SettlementChannel, SettlementLog>();
  for (const log of logs) {
    byChannel.set(log.channel, log);
  }

  const rows: ChannelSettlementRow[] = SETTLEMENT_CHANNELS.map((ch) => {
    const log = byChannel.get(ch);
    return {
      channel: ch,
      label: CHANNEL_LABEL[ch],
      expected: expected[ch],
      log: log ? computeRow(log) : null,
    };
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.expected += r.expected;
      acc.actual += r.log?.actualAmount ?? 0;
      acc.variance += r.log
        ? Number(r.log.actualAmount) - Number(r.log.expectedAmount)
        : 0;
      return acc;
    },
    { expected: 0, actual: 0, variance: 0 },
  );

  return ok({ date: dateIso, rows, totals });
}

export async function upsertSettlementLog(
  input: UpsertSettlementLogInput,
): Promise<ApiResult<SettlementLogRow>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "settlement_log.create")) {
    return fail("FORBIDDEN", "Tidak punya hak input mutasi");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.settlementDate)) {
    return fail("INVALID_DATE", "Format tanggal harus YYYY-MM-DD");
  }
  if (!SETTLEMENT_CHANNELS.includes(input.channel)) {
    return fail("INVALID_CHANNEL", "Channel tidak valid");
  }
  if (
    !Number.isFinite(input.expectedAmount) ||
    !Number.isFinite(input.actualAmount) ||
    input.expectedAmount < 0 ||
    input.actualAmount < 0
  ) {
    return fail("INVALID_AMOUNT", "Amount harus angka non-negatif");
  }

  const expected = Math.floor(input.expectedAmount);
  const actual = Math.floor(input.actualAmount);
  const notes = input.notes?.trim() || null;

  // Check existing.
  const [existing] = await db
    .select()
    .from(settlementLogs)
    .where(
      and(
        eq(settlementLogs.outletId, session.user.outletId),
        eq(settlementLogs.settlementDate, input.settlementDate),
        eq(settlementLogs.channel, input.channel),
        isNull(settlementLogs.deletedAt),
      ),
    )
    .limit(1);

  if (existing) {
    if (
      !hasPermission(session.user.role, "settlement_log.update")
    ) {
      return fail("FORBIDDEN", "Tidak punya hak update mutasi");
    }
    const before = {
      expectedAmount: Number(existing.expectedAmount),
      actualAmount: Number(existing.actualAmount),
      notes: existing.notes,
    };
    const [updated] = await db
      .update(settlementLogs)
      .set({
        expectedAmount: expected,
        actualAmount: actual,
        notes,
        updatedAt: new Date(),
        updatedBy: session.user.id,
      })
      .where(eq(settlementLogs.id, existing.id))
      .returning();

    await logAudit({
      eventType: "settlement_log.update",
      userId: session.user.id,
      entityType: "settlement_log",
      entityId: updated.id,
      payload: {
        summary: `${CHANNEL_LABEL[input.channel]} ${input.settlementDate}: actual ${actual.toLocaleString("id-ID")}`,
        before,
        after: {
          expectedAmount: expected,
          actualAmount: actual,
          notes,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit settlement_log.update]", e));

    return ok(computeRow(updated));
  }

  // Insert.
  const [inserted] = await db
    .insert(settlementLogs)
    .values({
      outletId: session.user.outletId,
      settlementDate: input.settlementDate,
      channel: input.channel,
      expectedAmount: expected,
      actualAmount: actual,
      notes,
      createdBy: session.user.id,
    })
    .returning();

  await logAudit({
    eventType: "settlement_log.create",
    userId: session.user.id,
    entityType: "settlement_log",
    entityId: inserted.id,
    payload: {
      summary: `${CHANNEL_LABEL[input.channel]} ${input.settlementDate}: actual ${actual.toLocaleString("id-ID")}`,
      after: {
        channel: input.channel,
        settlementDate: input.settlementDate,
        expectedAmount: expected,
        actualAmount: actual,
        notes,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit settlement_log.create]", e));

  return ok(computeRow(inserted));
}

export async function deleteSettlementLog(
  id: string,
): Promise<ApiResult<{ ok: true }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "settlement_log.delete")) {
    return fail("FORBIDDEN", "Tidak punya hak hapus mutasi");
  }

  const [existing] = await db
    .select()
    .from(settlementLogs)
    .where(eq(settlementLogs.id, id))
    .limit(1);
  if (!existing) return fail("NOT_FOUND", "Mutasi tidak ditemukan");
  if (existing.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Mutasi dari outlet lain");
  }
  if (existing.deletedAt) {
    return fail("ALREADY_DELETED", "Sudah dihapus");
  }

  await db
    .update(settlementLogs)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(settlementLogs.id, id));

  await logAudit({
    eventType: "settlement_log.delete",
    userId: session.user.id,
    entityType: "settlement_log",
    entityId: id,
    payload: {
      summary: `${CHANNEL_LABEL[existing.channel]} ${existing.settlementDate} dihapus`,
      before: {
        expectedAmount: Number(existing.expectedAmount),
        actualAmount: Number(existing.actualAmount),
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit settlement_log.delete]", e));

  return ok({ ok: true });
}

interface ExportRowsOptions {
  from: string; // YYYY-MM-DD
  to: string;
}

export async function exportSettlementLogsCsv(
  opts: ExportRowsOptions,
): Promise<ApiResult<{ csv: string; filename: string; rowCount: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "settlement_log.view")) {
    return fail("FORBIDDEN", "Tidak punya hak akses");
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(opts.from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(opts.to)
  ) {
    return fail("INVALID_DATE", "Format tanggal harus YYYY-MM-DD");
  }

  const rows = await db
    .select({
      log: settlementLogs,
      createdByName: users.name,
    })
    .from(settlementLogs)
    .leftJoin(users, eq(users.id, settlementLogs.createdBy))
    .where(
      and(
        eq(settlementLogs.outletId, session.user.outletId),
        gte(settlementLogs.settlementDate, opts.from),
        lte(settlementLogs.settlementDate, opts.to),
        isNull(settlementLogs.deletedAt),
      ),
    )
    .orderBy(settlementLogs.settlementDate, settlementLogs.channel);

  const header = [
    "Tanggal",
    "Channel",
    "Expected",
    "Actual",
    "Variance",
    "Variance %",
    "Tier",
    "Catatan",
    "Diinput Oleh",
    "Diinput Pada",
  ];
  const csvRows: string[] = [header.join(",")];
  for (const r of rows) {
    const row = computeRow(r.log);
    const tier = classifyVariance(row);
    const fields = [
      r.log.settlementDate,
      CHANNEL_LABEL[r.log.channel],
      String(Number(r.log.expectedAmount)),
      String(Number(r.log.actualAmount)),
      String(row.variance),
      (row.variancePct * 100).toFixed(2),
      tier,
      escapeCsv(r.log.notes ?? ""),
      escapeCsv(r.createdByName ?? ""),
      r.log.createdAt.toISOString(),
    ];
    csvRows.push(fields.join(","));
  }

  return ok({
    csv: csvRows.join("\n"),
    filename: `settlement-logs-${opts.from}-${opts.to}.csv`,
    rowCount: rows.length,
  });
}

function escapeCsv(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
