import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  investors,
  pengelola,
  profitDistributionLines,
  profitDistributions,
} from "@/db/schema";
import type {
  DistributionLineWithHolder,
  DistributionWithLines,
  ProfitDistribution,
} from "./types";

export async function fetchDistributions(
  outletId: string,
): Promise<ProfitDistribution[]> {
  return db
    .select()
    .from(profitDistributions)
    .where(eq(profitDistributions.outletId, outletId))
    .orderBy(
      desc(profitDistributions.periodYear),
      desc(profitDistributions.periodMonth),
      desc(profitDistributions.createdAt),
    );
}

export async function fetchDistributionWithLines(
  outletId: string,
  id: string,
): Promise<DistributionWithLines | null> {
  const [dist] = await db
    .select()
    .from(profitDistributions)
    .where(
      and(
        eq(profitDistributions.id, id),
        eq(profitDistributions.outletId, outletId),
      ),
    )
    .limit(1);
  if (!dist) return null;

  /* Pull lines + holder names via 2 small queries (no clean join for
   * polymorphic FK). */
  const lines = await db
    .select()
    .from(profitDistributionLines)
    .where(eq(profitDistributionLines.distributionId, id))
    .orderBy(
      asc(profitDistributionLines.holderType),
      desc(profitDistributionLines.modalDisetorSnapshot),
    );

  const investorIds = lines
    .filter((l) => l.holderType === "investor")
    .map((l) => l.holderId);
  const pengelolaIds = lines
    .filter((l) => l.holderType === "pengelola")
    .map((l) => l.holderId);

  /* Sesi AE-76 — replace sql`= ANY(${array})` dengan inArray() helper.
   * Pattern lama tidak reliable di Neon serverless prod (sama bug AE-68). */
  const investorRows =
    investorIds.length > 0
      ? await db
          .select({
            id: investors.id,
            fullName: investors.fullName,
            email: investors.email,
          })
          .from(investors)
          .where(inArray(investors.id, investorIds))
      : [];
  const pengelolaRows =
    pengelolaIds.length > 0
      ? await db
          .select({
            id: pengelola.id,
            fullName: pengelola.fullName,
            email: pengelola.email,
          })
          .from(pengelola)
          .where(inArray(pengelola.id, pengelolaIds))
      : [];

  const nameById = new Map<string, { fullName: string; email: string | null }>();
  for (const r of investorRows)
    nameById.set(r.id, { fullName: r.fullName, email: r.email });
  for (const r of pengelolaRows)
    nameById.set(r.id, { fullName: r.fullName, email: r.email });

  const enrichedLines: DistributionLineWithHolder[] = lines.map((l) => {
    const meta = nameById.get(l.holderId);
    return {
      ...l,
      holderName: meta?.fullName ?? "(unknown)",
      holderEmail: meta?.email ?? null,
    };
  });

  const totalLinesAmount = enrichedLines.reduce(
    (s, l) => s + l.amountRupiah,
    0,
  );

  return {
    ...dist,
    lines: enrichedLines,
    totalLinesAmount,
  };
}

export async function findDistributionForPeriod(
  outletId: string,
  year: number,
  month: number,
  statuses: Array<"draft" | "approved" | "posted" | "cancelled">,
): Promise<ProfitDistribution | null> {
  const [row] = await db
    .select()
    .from(profitDistributions)
    .where(
      and(
        eq(profitDistributions.outletId, outletId),
        eq(profitDistributions.periodYear, year),
        eq(profitDistributions.periodMonth, month),
        inArray(profitDistributions.status, statuses),
      ),
    )
    .limit(1);
  return row ?? null;
}
