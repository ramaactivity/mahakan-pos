"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { logAudit } from "@/lib/audit/logger";
import { cartEventSummary, type CartActivityEvent } from "./types";

const line = z.object({
  name: z.string().max(120),
  qty: z.number().int().min(0).max(999),
  subtotal: z.number().int().min(0),
});
const base = {
  draftId: z.string().min(1).max(64),
  label: z.string().max(80),
  shiftId: z.uuid().nullable(),
  at: z.iso.datetime(),
};
const eventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("item_remove"), ...base, line, totalBefore: z.number().int(), totalAfter: z.number().int() }),
  z.object({ kind: z.literal("discard"), ...base, items: z.array(line).max(50), totalBefore: z.number().int() }),
  z.object({
    kind: z.literal("commit"),
    ...base,
    transactionId: z.uuid().nullable(),
    clientRefId: z.uuid().nullable(),
  }),
]);

const EVENT_TYPE = {
  item_remove: "transaction.cart.item_remove",
  discard: "transaction.cart.discard",
  commit: "transaction.cart.commit",
} as const;

/**
 * Sesi AE-237 — terima batch jejak keranjang dari POS. Dipanggil di belakang
 * layar; kasir tidak pernah menunggu ini. Returns jumlah yang tersimpan.
 */
export async function recordCartActivity(input: unknown): Promise<{ saved: number }> {
  const session = await auth();
  if (!session || !hasPermission(session.user.role, "pos.transaction.create")) {
    return { saved: 0 };
  }
  const parsed = z.array(eventSchema).max(100).safeParse(input);
  if (!parsed.success) return { saved: 0 };

  for (const e of parsed.data as CartActivityEvent[]) {
    let transactionId = e.kind === "commit" ? e.transactionId : null;
    /* Offline sale: only the clientRefId is known on the tablet. */
    if (e.kind === "commit" && !transactionId && e.clientRefId) {
      const [t] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.clientRefId, e.clientRefId))
        .limit(1);
      transactionId = t?.id ?? null;
    }
    await logAudit({
      eventType: EVENT_TYPE[e.kind],
      userId: session.user.id,
      entityType: "transaction",
      entityId: transactionId,
      payload: {
        summary: cartEventSummary(e),
        context: { ...e, transactionId },
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    });
  }
  return { saved: parsed.data.length };
}
