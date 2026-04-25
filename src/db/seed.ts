/**
 * Initial Phase 1 seed for Mahakan POS.
 *
 * Inserts: 1 outlet, 1 Owner user (from SEED_OWNER_* env), 11 categories,
 * 43 menu items, 4 modifiers, 9 expense categories.
 *
 * Per C4 decision: only Owner is seeded. Manager + Staff users are created
 * by Owner via admin UI after first login.
 *
 * Idempotent: aborts if any outlet row already exists.
 *
 * Run: `npm run db:seed`
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import bcrypt from "bcryptjs";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import {
  outlets,
  users,
  categories,
  menuItems,
  modifiers,
  expenseCategories,
} from "./schema";

import {
  mockOutlet,
  mockCategories,
  mockMenuItems,
  mockModifiers,
  mockExpenseCategories,
} from "../mocks/data";

const REQUIRED_ENV = [
  "DATABASE_URL",
  "SEED_OWNER_NAME",
  "SEED_OWNER_EMAIL",
  "SEED_OWNER_PASSWORD",
] as const;

async function main() {
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
      throw new Error(`Missing required env: ${key} (set in .env.local)`);
    }
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const existing = await db.select({ id: outlets.id }).from(outlets).limit(1);
  if (existing.length > 0) {
    console.log(
      "⚠️  Outlets table already populated — seed is one-shot. Aborting.",
    );
    console.log(
      "   To re-seed, drop the public schema and re-run db:migrate first.",
    );
    await pool.end();
    process.exit(0);
  }

  console.log("🌱 Seeding Mahakan POS Phase 1 data...\n");

  const [outlet] = await db
    .insert(outlets)
    .values({
      name: mockOutlet.name,
      address: mockOutlet.address,
      phone: mockOutlet.phone,
      logoUrl: mockOutlet.logoUrl,
      operationalHours: mockOutlet.operationalHours,
      settings: mockOutlet.settings,
      isActive: true,
    })
    .returning({ id: outlets.id });
  console.log(`  ✓ Outlet: ${mockOutlet.name}`);

  const passwordHash = await bcrypt.hash(process.env.SEED_OWNER_PASSWORD!, 12);
  const [owner] = await db
    .insert(users)
    .values({
      outletId: outlet.id,
      name: process.env.SEED_OWNER_NAME!,
      email: process.env.SEED_OWNER_EMAIL!,
      passwordHash,
      role: "owner",
      status: "active",
    })
    .returning({ id: users.id });
  console.log(`  ✓ Owner: ${process.env.SEED_OWNER_NAME} <${process.env.SEED_OWNER_EMAIL}>`);

  const catSlugToId = new Map<string, string>();
  for (const c of mockCategories) {
    const [row] = await db
      .insert(categories)
      .values({
        outletId: outlet.id,
        name: c.name,
        displayOrder: c.displayOrder,
        isActive: true,
        createdBy: owner.id,
      })
      .returning({ id: categories.id });
    catSlugToId.set(c.id, row.id);
  }
  console.log(`  ✓ Categories: ${mockCategories.length}`);

  for (const m of mockMenuItems) {
    const dbCategoryId = catSlugToId.get(m.categoryId);
    if (!dbCategoryId) {
      throw new Error(`Missing category mapping for menu item: ${m.name}`);
    }
    await db.insert(menuItems).values({
      outletId: outlet.id,
      categoryId: dbCategoryId,
      name: m.name,
      description: m.description,
      priceType: m.priceType,
      priceFixed: m.priceFixed,
      priceHot: m.priceHot,
      priceIced: m.priceIced,
      isSignature: m.isSignature,
      displayOrder: m.displayOrder,
      createdBy: owner.id,
    });
  }
  console.log(`  ✓ Menu items: ${mockMenuItems.length}`);

  for (const mod of mockModifiers) {
    const appliesUuids = mod.appliesToCategories
      ?.map((slug) => catSlugToId.get(slug))
      .filter((x): x is string => Boolean(x));
    await db.insert(modifiers).values({
      slug: mod.slug,
      label: mod.label,
      type: mod.type,
      optionsJson: mod.options ?? null,
      price: mod.price,
      appliesToCategories: appliesUuids,
      isActive: true,
      updatedBy: owner.id,
    });
  }
  console.log(`  ✓ Modifiers: ${mockModifiers.length}`);

  for (const ec of mockExpenseCategories) {
    await db.insert(expenseCategories).values({
      outletId: outlet.id,
      name: ec.name,
      isSystem: ec.isSystem,
      displayOrder: ec.displayOrder,
    });
  }
  console.log(`  ✓ Expense categories: ${mockExpenseCategories.length}`);

  console.log("\n✅ Seed complete.");
  console.log(`   Login: ${process.env.SEED_OWNER_EMAIL}`);
  console.log("   Next: Owner creates Manager + Staff via admin UI.\n");

  await pool.end();
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
