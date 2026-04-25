/**
 * Dev tool: set/reset a user's PIN by email.
 *
 *   npx tsx scripts/set-user-pin.ts <email> <pin>
 *
 * Examples:
 *   npx tsx scripts/set-user-pin.ts rama.activity98@gmail.com 1234
 *
 * Once the admin "Reset PIN" UI lands (M14), this script becomes redundant
 * but stays useful for emergency Owner unlock.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";

import { users } from "@/db/schema";
import { hashPin, isValidPinFormat } from "@/lib/auth/pin";

async function main() {
  const [, , email, pin] = process.argv;
  if (!email || !pin) {
    console.error("Usage: npx tsx scripts/set-user-pin.ts <email> <pin>");
    process.exit(1);
  }
  if (!isValidPinFormat(pin)) {
    console.error("PIN must be 4-6 digits");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const [user] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!user) {
    console.error(`No user found with email: ${email}`);
    await pool.end();
    process.exit(1);
  }

  const pinHash = await hashPin(pin);
  await db
    .update(users)
    .set({ pinHash, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  console.log(`✓ PIN updated for ${user.name} <${email}>`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
