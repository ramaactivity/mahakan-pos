import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import type { ListSuppliersOptions, Supplier } from "./types";

export async function fetchSuppliers(
  outletId: string,
  opts: ListSuppliersOptions = {},
): Promise<Supplier[]> {
  const { activeOnly = true, search } = opts;
  const conds = [
    eq(suppliers.outletId, outletId),
    isNull(suppliers.deletedAt),
  ];
  if (activeOnly) conds.push(eq(suppliers.isActive, true));
  if (search) {
    const like = `%${search.toLowerCase().trim()}%`;
    conds.push(sql`lower(${suppliers.name}) like ${like}`);
  }

  return db
    .select()
    .from(suppliers)
    .where(and(...conds))
    .orderBy(asc(suppliers.name));
}

export async function fetchSupplierById(
  id: string,
  outletId: string,
): Promise<Supplier | null> {
  const [row] = await db
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, id),
        eq(suppliers.outletId, outletId),
        isNull(suppliers.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}
