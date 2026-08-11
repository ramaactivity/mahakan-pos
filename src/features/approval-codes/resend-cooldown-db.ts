import "server-only";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { approvalCodes } from "@/db/schema";
import { resendCooldownWaitSeconds } from "./resend-cooldown";

/**
 * Sesi AE-196 — berapa detik lagi permintaan kode berikutnya boleh dikirim.
 *
 * `scope` menentukan apa yang dihitung sebagai "permintaan yang sama".
 * Untuk void/refund dipakai transaksinya (dua transaksi berbeda tidak saling
 * memblokir); untuk alur yang tiap permintaannya melahirkan baris pending
 * baru (koreksi, rebalance, usulan perubahan kas, compliment) dipakai
 * peminta + outlet, sekaligus mencegah usulan kembar.
 */
export async function approvalResendWaitSeconds(
  actionType: string,
  scope: SQL | undefined,
  now: Date = new Date(),
): Promise<number> {
  const [recent] = await db
    .select({ createdAt: approvalCodes.createdAt })
    .from(approvalCodes)
    .where(
      and(
        eq(
          approvalCodes.actionType,
          actionType as (typeof approvalCodes.actionType)["_"]["data"],
        ),
        scope,
      ),
    )
    .orderBy(desc(approvalCodes.createdAt))
    .limit(1);
  return resendCooldownWaitSeconds(recent?.createdAt, now);
}
