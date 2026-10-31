import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { menuItems, promos } from "@/db/schema";
import {
  promoWaivesPinApprover,
  wibWallClock,
  type CartContext,
} from "./eligibility";

/**
 * Sesi AE-259 — server side of "promo tanpa persetujuan".
 *
 * The PIN gate used to demand an approver for EVERY staff discount, so the
 * promo setting "Butuh persetujuan Owner / Manager" only lived in the POS
 * screen: a promo with the box unticked still died with APPROVER_REQUIRED.
 * createTransaction and editOpenBill both ask this one function.
 */
export async function promoWaivesApprovalForCart(input: {
  outletId: string;
  promoId: string | null | undefined;
  items: ReadonlyArray<{ menuItemId: string; subtotal: number }>;
  subtotal: number;
  discountAmount: number;
  orderType: CartContext["orderType"];
  paymentMethod: CartContext["paymentMethod"];
}): Promise<boolean> {
  if (!input.promoId || input.discountAmount <= 0) return false;

  const menuIds = [...new Set(input.items.map((i) => i.menuItemId))];
  const [[promo], menuRows] = await Promise.all([
    db
      .select()
      .from(promos)
      .where(
        and(
          eq(promos.id, input.promoId),
          eq(promos.outletId, input.outletId),
          isNull(promos.deletedAt),
        ),
      )
      .limit(1),
    menuIds.length > 0
      ? db
          .select({ id: menuItems.id, categoryId: menuItems.categoryId })
          .from(menuItems)
          .where(inArray(menuItems.id, menuIds))
      : Promise.resolve([]),
  ]);
  const categoryById = new Map(menuRows.map((r) => [r.id, r.categoryId]));

  return promoWaivesPinApprover(
    promo ?? null,
    {
      subtotal: input.subtotal,
      lines: input.items.map((i) => ({
        categoryId: categoryById.get(i.menuItemId) ?? null,
        lineSubtotal: i.subtotal,
      })),
      orderType: input.orderType,
      paymentMethod: input.paymentMethod,
      now: wibWallClock(new Date()),
    },
    input.discountAmount,
  );
}
