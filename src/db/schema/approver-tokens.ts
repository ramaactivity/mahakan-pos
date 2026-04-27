import {
  pgTable,
  uuid,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Single-use approver token blacklist. Prevents replay of consumed tokens
 * across multiple Vercel serverless instances (the in-memory Map approach
 * was racey — two instances could each accept the same jti).
 *
 * Row lifetime is short — the token's own exp is 5 min, so we keep rows
 * up to ~24h then garbage-collect (opportunistic prune at consume time).
 */
export const consumedApproverTokens = pgTable(
  "consumed_approver_tokens",
  {
    jti: uuid("jti").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_consumed_approver_expires").on(t.expiresAt)],
);
