import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const { db } = await import("@/db");
  const { journalEntries, creditors } = await import("@/db/schema");
  const { eq, and } = await import("drizzle-orm");
  const convEntries = await db.select().from(journalEntries)
    .where(and(eq(journalEntries.sourceType, "investor_to_creditor_conversion"), eq(journalEntries.status, "posted")));
  const active = await db.select({ name: creditors.fullName, status: creditors.status, deletedAt: creditors.deletedAt, out: creditors.principalOutstanding }).from(creditors);
  const names = new Set(active.filter(c => !c.deletedAt && c.status === "active").map(c => c.name.trim().toLowerCase()));
  for (const e of convEntries) {
    const nm = /Convert investor "(.+?)"/.exec(e.description ?? "")?.[1];
    if (nm && !names.has(nm.trim().toLowerCase())) {
      console.log("ORPHAN:", e.entryNumber, "—", nm, "—", e.description?.slice(0, 70));
      const rows = active.filter(c => c.name.trim().toLowerCase() === nm.trim().toLowerCase());
      console.log("  di tabel creditors (semua status):", rows);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
