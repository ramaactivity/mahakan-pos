import "server-only";
import { inArray, sql } from "drizzle-orm";
import {
  investors,
  pengelola,
  creditors,
  internalDebtParties,
} from "@/db/schema";
import type { Database } from "@/db";

/**
 * Sesi AE-80 — Row-locking helpers untuk Modal & Dividen v2.
 *
 * Modul ini menghidupkan invariant "saldo dividen + saldo bank di-mutate
 * atomik" dengan PG row-level locks (`SELECT FOR UPDATE`) + advisory locks
 * untuk resource yang tidak punya row (mis. bank account sebagai logical
 * resource — meskipun ada `bank_accounts` row, balance-nya derived dari
 * journal_entries, jadi pakai advisory lock per bankAccountId untuk
 * serialize concurrent withdrawal/repayment).
 *
 * DESIGN NOTES:
 *
 * 1. **Row lock sort order**: SELECT FOR UPDATE pakai ORDER BY id untuk
 *    konsistensi acquisition order. 2 concurrent txn yang sama-sama lock
 *    [investor A, B] akan acquire dengan urutan sama → tidak deadlock.
 *
 * 2. **Advisory lock key**: hashtext('bank-' || bankAccountId) → int4
 *    deterministic. Hash collision risk minor untuk 99% kasus (1 outlet
 *    biasanya < 10 bank accounts).
 *
 * 3. **Lock scope**: locks otomatis released saat transaction commit/
 *    rollback (advisory_xact_lock + FOR UPDATE keduanya transaction-scoped).
 *
 * 4. **Reuse**: helper di pakai oleh services di:
 *    - withdrawals.postWithdrawal (lock investor + bank)
 *    - profit-distributions.approveAndPostDistribution (lock all investors)
 *    - profit-distributions.reverseDistribution (lock all investors in lines)
 *    - share-transactions.transferShareP2P (lock both investors)
 *    - share-transactions.companyBuyback (lock investor + bank)
 *    - creditor-repayments.postRepayment (lock creditor + bank)
 */

type TxLike = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Lock investor rows by id (sorted, dedup). FOR UPDATE blocks concurrent
 * tx yang mutate same rows until current tx commits.
 *
 * Empty `ids` → no-op (skip query). Dedup via Set untuk menghindari
 * duplicate row lock (Postgres tetap acquire 1x tapi pemanggilan SELECT
 * lebih clean).
 */
export async function lockInvestors(
  tx: TxLike,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const unique = Array.from(new Set(ids)).sort();
  await tx
    .select({ id: investors.id })
    .from(investors)
    .where(inArray(investors.id, unique))
    .for("update");
}

/**
 * Lock pengelola rows by id. Pattern sama dengan lockInvestors.
 */
export async function lockPengelola(
  tx: TxLike,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const unique = Array.from(new Set(ids)).sort();
  await tx
    .select({ id: pengelola.id })
    .from(pengelola)
    .where(inArray(pengelola.id, unique))
    .for("update");
}

/**
 * Lock creditor row by id. Single creditor per call (repayment hanya
 * touch 1 creditor at a time).
 */
export async function lockCreditor(
  tx: TxLike,
  id: string,
): Promise<void> {
  await tx
    .select({ id: creditors.id })
    .from(creditors)
    .where(inArray(creditors.id, [id]))
    .for("update");
}

/**
 * Sesi AE-180 — Lock internal debt party row by id. Serialize concurrent
 * entry/repayment yang mutate totalOutstanding party yang sama.
 */
export async function lockInternalDebtParty(
  tx: TxLike,
  id: string,
): Promise<void> {
  await tx
    .select({ id: internalDebtParties.id })
    .from(internalDebtParties)
    .where(inArray(internalDebtParties.id, [id]))
    .for("update");
}

/**
 * Advisory transaction lock per bankAccountId. Pakai untuk serialize
 * concurrent withdraw/repayment/buyback yang tarik kas dari bank yang
 * sama (race condition pre-check bank balance vs commit window).
 *
 * `pg_advisory_xact_lock(hashtext(...))` returns void; tx-scoped release.
 *
 * Key collision: hashtext mungkin collide untuk 2 bank id yang berbeda
 * (very rare). Kalau collide, mereka serialized — slight perf hit, no
 * correctness issue.
 */
export async function lockBankAccountAdvisory(
  tx: TxLike,
  bankAccountId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`bank-${bankAccountId}`}))`,
  );
}

/**
 * Advisory lock per outlet untuk operasi yang touch multiple investors
 * + share_pct sum invariant (mis. p2p_transfer). Mencegah 2 concurrent
 * transfer yang individually valid tapi combined memecah 100% sum.
 */
export async function lockOutletDividenAdvisory(
  tx: TxLike,
  outletId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`dividen-${outletId}`}))`,
  );
}
