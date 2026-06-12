import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const { db } = await import("@/db");
  const { journalEntries, creditors } = await import("@/db/schema");
  const { eq, and, isNull } = await import("drizzle-orm");
  const convEntries = await db
    .select({ sourceId: journalEntries.sourceId, descr: journalEntries.description })
    .from(journalEntries)
    .where(eq(journalEntries.sourceType, "investor_to_creditor_conversion"))
    .limit(3);
  for (const e of convEntries) {
    const [c] = await db.select({ id: creditors.id, name: creditors.fullName, conv: creditors.convertedFromInvestorAt })
      .from(creditors).where(eq(creditors.id, e.sourceId!)).limit(1);
    console.log("journal sourceId:", e.sourceId, "→ creditor?", c ? `${c.name} (convertedAt ${c.conv})` : "BUKAN creditor id");
  }
  // sample kreditur bernama Mahiya
  const rows = await db.select({ id: creditors.id, name: creditors.fullName, conv: creditors.convertedFromInvestorAt, out: creditors.principalOutstanding })
    .from(creditors).where(and(isNull(creditors.deletedAt), eq(creditors.fullName, "Mahiya")));
  console.log("kreditur Mahiya:", rows);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
