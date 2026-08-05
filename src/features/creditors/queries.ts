import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  creditorRepayments,
  creditors,
  users,
} from "@/db/schema";
import type {
  Creditor,
  CreditorListRow,
  CreditorRepaymentListRow,
} from "./types";

/**
 * Sesi AE-80 — Creditor queries.
 *
 * listCreditors: outlet-scoped, optional status filter. Joined dengan
 * aggregate cicilan (totalPaidPrincipal, totalPaidInterest, count).
 *
 * fetchCreditorById: single row + repayment history.
 */

export async function listCreditors(opts: {
  outletId: string;
  status?: "active" | "settled" | "defaulted" | "all";
  includeDeleted?: boolean;
}): Promise<CreditorListRow[]> {
  const conds = [eq(creditors.outletId, opts.outletId)];
  if (!opts.includeDeleted) {
    conds.push(isNull(creditors.deletedAt));
  }
  if (opts.status && opts.status !== "all") {
    conds.push(eq(creditors.status, opts.status));
  }

  const creditorRows = await db
    .select()
    .from(creditors)
    .where(and(...conds))
    .orderBy(desc(creditors.createdAt));

  if (creditorRows.length === 0) return [];

  /* Aggregate repayments per creditor (kalau ada). */
  const creditorIds = creditorRows.map((c) => c.id);
  const aggs = await db
    .select({
      creditorId: creditorRepayments.creditorId,
      sumPrincipal: sql<number>`SUM(${creditorRepayments.principalAmount})::bigint`,
      sumInterest: sql<number>`SUM(${creditorRepayments.interestAmount})::bigint`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(creditorRepayments)
    .where(
      and(
        inArray(creditorRepayments.creditorId, creditorIds),
        eq(creditorRepayments.status, "posted"),
      ),
    )
    .groupBy(creditorRepayments.creditorId);

  const aggMap = new Map(
    aggs.map((a) => [
      a.creditorId,
      {
        totalPaidPrincipal: Number(a.sumPrincipal ?? 0),
        totalPaidInterest: Number(a.sumInterest ?? 0),
        repaymentCount: a.count,
      },
    ]),
  );

  return creditorRows.map((c) => ({
    ...c,
    totalPaidPrincipal: aggMap.get(c.id)?.totalPaidPrincipal ?? 0,
    totalPaidInterest: aggMap.get(c.id)?.totalPaidInterest ?? 0,
    repaymentCount: aggMap.get(c.id)?.repaymentCount ?? 0,
  }));
}

/**
 * Sesi AE-184 follow-up — summary kartu ringkasan dihitung di server dari
 * SEMUA kreditur outlet, bukan dari daftar yang sedang tersaring di UI.
 * Sebelumnya kartu "Total Hutang Outstanding" ikut filter status halaman
 * (tab "Lunas" → Rp 0 padahal akun 2150 masih ada saldo) dan "Bunga YTD"
 * dijumlah client-side dari fetchRepayments({ limit: 100 }) — diam-diam
 * undercount begitu cicilan setahun lewat 100 baris.
 *
 * - totalOutstanding + activeCount: kreditur status 'active' (non-deleted).
 * - interestYtd: SUM bunga cicilan status 'posted' tahun kalender berjalan,
 *   batas tahun mengikuti Asia/Jakarta (bukan UTC).
 */
export interface CreditorSummary {
  totalOutstanding: number;
  activeCount: number;
  interestYtd: number;
}

export async function getCreditorSummary(opts: {
  outletId: string;
}): Promise<CreditorSummary> {
  const [outstanding] = await db
    .select({
      totalOutstanding: sql<number>`COALESCE(SUM(${creditors.principalOutstanding}), 0)::bigint`,
      activeCount: sql<number>`COUNT(*)::int`,
    })
    .from(creditors)
    .where(
      and(
        eq(creditors.outletId, opts.outletId),
        isNull(creditors.deletedAt),
        eq(creditors.status, "active"),
      ),
    );

  const [interest] = await db
    .select({
      interestYtd: sql<number>`COALESCE(SUM(${creditorRepayments.interestAmount}), 0)::bigint`,
    })
    .from(creditorRepayments)
    .where(
      and(
        eq(creditorRepayments.outletId, opts.outletId),
        /* Sama seperti aggregate di listCreditors: cicilan reversed di-skip. */
        eq(creditorRepayments.status, "posted"),
        /* Tahun berjalan menurut wall-clock WIB. */
        sql`(${creditorRepayments.occurredAt} AT TIME ZONE 'Asia/Jakarta') >= date_trunc('year', now() AT TIME ZONE 'Asia/Jakarta')`,
      ),
    );

  return {
    totalOutstanding: Number(outstanding?.totalOutstanding ?? 0),
    activeCount: outstanding?.activeCount ?? 0,
    interestYtd: Number(interest?.interestYtd ?? 0),
  };
}

export async function fetchCreditorById(
  outletId: string,
  id: string,
): Promise<Creditor | null> {
  const [row] = await db
    .select()
    .from(creditors)
    .where(
      and(
        eq(creditors.id, id),
        eq(creditors.outletId, outletId),
        isNull(creditors.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listCreditorRepayments(opts: {
  outletId: string;
  creditorId?: string;
  limit?: number;
}): Promise<CreditorRepaymentListRow[]> {
  const limit = Math.min(opts.limit ?? 200, 1000);
  const conds = [eq(creditorRepayments.outletId, opts.outletId)];
  if (opts.creditorId) {
    conds.push(eq(creditorRepayments.creditorId, opts.creditorId));
  }
  const rows = await db
    .select({
      r: creditorRepayments,
      creditorName: creditors.fullName,
      bankName: bankAccounts.bankName,
      accountName: bankAccounts.accountName,
      accountNumber: bankAccounts.accountNumber,
      createdByName: users.name,
    })
    .from(creditorRepayments)
    .leftJoin(creditors, eq(creditors.id, creditorRepayments.creditorId))
    .leftJoin(
      bankAccounts,
      eq(bankAccounts.id, creditorRepayments.bankAccountId),
    )
    .leftJoin(users, eq(users.id, creditorRepayments.createdBy))
    .where(and(...conds))
    .orderBy(desc(creditorRepayments.occurredAt))
    .limit(limit);

  return rows.map((row) => {
    const numTail =
      row.accountNumber && row.accountNumber.length > 4
        ? `...${row.accountNumber.slice(-4)}`
        : row.accountNumber ?? "";
    return {
      ...row.r,
      creditorName: row.creditorName ?? "(unknown)",
      bankLabel: [row.bankName, row.accountName, numTail]
        .filter(Boolean)
        .join(" — "),
      createdByName: row.createdByName ?? null,
    };
  });
}
