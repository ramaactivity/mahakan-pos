import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventType: text("event_type").notNull(),
    userId: uuid("user_id").references(() => users.id),
    approverId: uuid("approver_id").references(() => users.id),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),

    payload: jsonb("payload"),
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_audit_logs_event_type").on(t.eventType),
    index("idx_audit_logs_user").on(t.userId),
    index("idx_audit_logs_entity").on(t.entityType, t.entityId),
    index("idx_audit_logs_created").on(t.createdAt),
  ],
);
