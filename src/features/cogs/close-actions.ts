"use server";

/**
 * Sesi AE-116 — Period close action: reconcile recognized HPP vs actual
 * COGS, post adjustment journal, lock period.
 *
 * Workflow:
 *   1. Owner clicks "Tutup Periode" di COGS section
 *   2. Validate: belum closed, opname akhir bulan exists
 *   3. Compute COGS report (existing logic) → actual per section
 *   4. Sum recognized HPP from journal_entries WHERE source_type='pos_sale'
 *      in period, lines on account codes 5101/5102/5103 grouped by code
 *   5. Per section: adjustment = actual - recognized
 *   6. Post adjustment journal:
 *        Dr 5101/5102/5103 HPP <section>  (signed by section variance)
 *        Cr 1140/1141/1142 Persediaan
 *   7. Insert cogs_period_closes row dengan adjustmentJournalEntryId
 *
 * Idempotent: unique(outletId, periodYm). Already closed → return existing.
 */

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  cogsPeriodCloses,
  journalEntries,
  journalLines,
  chartOfAccounts,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { recordJournal } from "@/features/accounting/posting";
import { getCogsReport } from "./queries";
import { isOk, type ApiResult, type ApiOk, type ApiFail } from "./cogs-calc";

function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}

function fail(code: string, message: string): ApiFail {
  return { ok: false, error: { code, message } };
}

export interface CogsPeriodCloseResult {
  id: string;
  periodYm: string;
  totalCogs: number;
  totalsBySection: {
    kitchen: number;
    bar: number;
    supporting: number;
    cleaning: number;
    unassigned: number;
  };
  adjustmentTotal: number;
  adjustmentJournalEntryId: string | null;
  alreadyClosed: boolean;
}

export async function fetchCogsPeriodCloseStatus(
  ym: string,
): Promise<ApiResult<CogsPeriodCloseResult | null>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi expired");
  if (!hasPermission(session.user.role, "accounting.report.view")) {
    return fail("FORBIDDEN", "Tidak punya akses");
  }
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    return fail("VALIDATION_ERROR", "Format YYYY-MM");
  }

  const [row] = await db
    .select()
    .from(cogsPeriodCloses)
    .where(
      and(
        eq(cogsPeriodCloses.outletId, session.user.outletId),
        eq(cogsPeriodCloses.periodYm, ym),
      ),
    )
    .limit(1);
  if (!row) return ok(null);
  return ok({
    id: row.id,
    periodYm: row.periodYm,
    totalCogs: row.totalCogs,
    totalsBySection: JSON.parse(row.totalsBySection) as {
      kitchen: number;
      bar: number;
      supporting: number;
      cleaning: number;
      unassigned: number;
    },
    adjustmentTotal: row.adjustmentTotal,
    adjustmentJournalEntryId: row.adjustmentJournalEntryId,
    alreadyClosed: true,
  });
}

/**
 * Section → (HPP code, Persediaan code). Unassigned + cleaning → 5103/1142.
 */
function accountCodesForSection(
  section: "kitchen" | "bar" | "supporting" | "cleaning" | "unassigned",
): { hpp: string; persediaan: string } {
  switch (section) {
    case "kitchen":
      return { hpp: "5101", persediaan: "1140" };
    case "bar":
      return { hpp: "5102", persediaan: "1141" };
    case "supporting":
    case "cleaning":
    case "unassigned":
      return { hpp: "5103", persediaan: "1142" };
  }
}

export async function closeCogsPeriod(
  ym: string,
): Promise<ApiResult<CogsPeriodCloseResult>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi expired");
  if (!hasPermission(session.user.role, "accounting.report.view")) {
    return fail("FORBIDDEN", "Tidak punya akses");
  }
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    return fail("VALIDATION_ERROR", "Format YYYY-MM");
  }

  // Idempotency: already closed?
  const existing = await fetchCogsPeriodCloseStatus(ym);
  if (isOk(existing) && existing.data) {
    return ok({ ...existing.data, alreadyClosed: true });
  }

  // Fetch COGS report
  const report = await getCogsReport({
    outletId: session.user.outletId,
    ym,
  });

  /* Compute recognized HPP per section from journal entries (pos_sale +
   * pos_refund + shift_variance — any source yang post ke 5101/5102/5103).
   *
   * Join journal_lines × chart_of_accounts → filter cost accounts → sum
   * (debit - credit) per code (debit-normal HPP, positive recognized cost).
   */
  const fromDate = report.period.fromDate;
  const toDate = report.period.toDate;
  const recRows = await db.execute<{
    code: string;
    net: string;
  }>(sql`
    SELECT
      coa.code AS code,
      SUM(jl.debit - jl.credit)::text AS net
    FROM journal_entries je
    INNER JOIN journal_lines jl ON jl.entry_id = je.id
    INNER JOIN chart_of_accounts coa ON coa.id = jl.account_id
    WHERE je.outlet_id = ${session.user.outletId}
      AND je.status = 'posted'
      AND je.entry_date >= ${fromDate}
      AND je.entry_date <= ${toDate}
      AND coa.code IN ('5101','5102','5103')
    GROUP BY coa.code
  `);
  const recArr = ((recRows as unknown as { rows?: unknown[] }).rows ?? []) as Array<{ code: string; net: string }>;
  const recognized: Record<string, number> = { "5101": 0, "5102": 0, "5103": 0 };
  for (const r of recArr) recognized[r.code] = Number(r.net);

  /* Actual COGS per section (dari WAC report). Map ke account codes. */
  const actual = report.summary.bySection;
  const actualByHppCode: Record<string, number> = {
    "5101": actual.kitchen,
    "5102": actual.bar,
    "5103": actual.supporting + actual.cleaning + actual.unassigned,
  };

  /* Adjustment lines = actual - recognized per HPP code. Build journal. */
  const journalLineInputs: Array<{
    accountCode: string;
    debit?: number;
    credit?: number;
    description?: string;
  }> = [];
  let adjustmentTotal = 0;

  for (const hppCode of ["5101", "5102", "5103"] as const) {
    const diff = actualByHppCode[hppCode] - recognized[hppCode];
    if (diff === 0) continue;
    const persediaanCode =
      hppCode === "5101" ? "1140" : hppCode === "5102" ? "1141" : "1142";
    const label =
      hppCode === "5101" ? "kitchen" : hppCode === "5102" ? "bar" : "supporting/cleaning";

    if (diff > 0) {
      // Actual > recognized: post additional HPP (extra cost realized).
      journalLineInputs.push({
        accountCode: hppCode,
        debit: diff,
        description: `Adjust HPP ${label} (period close ${ym})`,
      });
      journalLineInputs.push({
        accountCode: persediaanCode,
        credit: diff,
        description: `Adjust Persediaan ${label} (period close ${ym})`,
      });
    } else {
      // Actual < recognized: reverse over-recognized HPP.
      const abs = Math.abs(diff);
      journalLineInputs.push({
        accountCode: hppCode,
        credit: abs,
        description: `Reverse HPP ${label} (period close ${ym}, over-recognized)`,
      });
      journalLineInputs.push({
        accountCode: persediaanCode,
        debit: abs,
        description: `Reverse Persediaan ${label} (period close ${ym})`,
      });
    }
    adjustmentTotal += diff;
  }

  // Insert period close row first (to get id for sourceId)
  let inserted: typeof cogsPeriodCloses.$inferSelect;
  try {
    [inserted] = await db
      .insert(cogsPeriodCloses)
      .values({
        outletId: session.user.outletId,
        periodYm: ym,
        closedBy: session.user.id,
        totalCogs: report.summary.total,
        totalsBySection: JSON.stringify(report.summary.bySection),
        adjustmentTotal,
        notes: `Closed by ${session.user.email}. ${journalLineInputs.length} adjustment lines.`,
      })
      .returning();
  } catch (e) {
    if (e instanceof Error && /unique/i.test(e.message)) {
      // Race condition — already closed
      const re = await fetchCogsPeriodCloseStatus(ym);
      if (isOk(re) && re.data) return ok({ ...re.data, alreadyClosed: true });
    }
    return fail(
      "DB_ERROR",
      e instanceof Error ? e.message : "Gagal insert close row",
    );
  }

  // Post adjustment journal kalau ada lines
  let adjustmentJournalEntryId: string | null = null;
  if (journalLineInputs.length > 0) {
    try {
      const result = await recordJournal({
        outletId: session.user.outletId,
        entryDate: report.period.toDate, // last day of period
        description: `COGS period close ${report.period.label} — adjustment`,
        sourceType: "cogs_period_close",
        sourceId: inserted.id,
        lines: journalLineInputs,
        actorId: session.user.id,
      });
      adjustmentJournalEntryId = result.entryId;
      // Update period close with journal ref
      await db
        .update(cogsPeriodCloses)
        .set({ adjustmentJournalEntryId })
        .where(eq(cogsPeriodCloses.id, inserted.id));
    } catch (e) {
      // Roll back period close row — keep DB consistent
      await db
        .delete(cogsPeriodCloses)
        .where(eq(cogsPeriodCloses.id, inserted.id));
      return fail(
        "JOURNAL_POST_FAILED",
        e instanceof Error
          ? e.message
          : "Gagal post adjustment journal — period close di-rollback",
      );
    }
  }

  // Audit log
  await logAudit({
    eventType: "accounting_period.close",
    userId: session.user.id,
    entityType: "accounting_period",
    entityId: inserted.id,
    payload: {
      summary: `COGS period close ${ym}: total=${report.summary.total}, adjustment=${adjustmentTotal}`,
      after: {
        periodYm: ym,
        totalCogs: report.summary.total,
        adjustmentTotal,
        adjustmentJournalEntryId,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  return ok({
    id: inserted.id,
    periodYm: ym,
    totalCogs: report.summary.total,
    totalsBySection: {
      kitchen: report.summary.bySection.kitchen,
      bar: report.summary.bySection.bar,
      supporting: report.summary.bySection.supporting,
      cleaning: report.summary.bySection.cleaning,
      unassigned: report.summary.bySection.unassigned,
    },
    adjustmentTotal,
    adjustmentJournalEntryId,
    alreadyClosed: false,
  });
}
