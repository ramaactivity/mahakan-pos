import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import {
  profitDistributions,
  profitDistributionLines,
} from "./profit_distributions";

/**
 * Sesi AE-63a — Log email statement dividen ke investor + pengelola.
 *
 * Mirror pattern `payroll_payslip_emails` (sesi AE-62ad) — 1 row per
 * send attempt (auto trigger saat distribution posted, atau manual
 * resend dari UI).
 *
 * Tujuan: audit trail siapa terima statement kapan, debug delivery
 * failures, owner UI lihat siapa email-nya bounce/belum diisi.
 */
export const investorStatementEmails = pgTable(
  "investor_statement_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    distributionId: uuid("distribution_id")
      .notNull()
      .references(() => profitDistributions.id, { onDelete: "cascade" }),
    lineId: uuid("line_id")
      .notNull()
      .references(() => profitDistributionLines.id, { onDelete: "cascade" }),

    /** Polymorphic FK ke investors / pengelola (app-side validate). */
    holderType: text("holder_type", {
      enum: ["investor", "pengelola"],
    }).notNull(),
    holderId: uuid("holder_id").notNull(),

    toEmail: text("to_email").notNull(),
    trigger: text("trigger", { enum: ["auto", "manual"] }).notNull(),

    /** Provider message id (Gmail SMTP / Resend). NULL kalau logged/failed. */
    messageId: text("message_id"),
    status: text("status", {
      enum: ["sent", "failed", "logged"],
    }).notNull(),
    errorMessage: text("error_message"),
    /** "AUTH_FAILED" | "CONNECTION_TIMEOUT" | "RATE_LIMITED" |
     *  "INVALID_RECIPIENT" | "NO_EMAIL" | "UNKNOWN" */
    errorCode: text("error_code"),

    sentBy: uuid("sent_by").references(() => users.id),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_statement_emails_distribution").on(t.distributionId, t.sentAt),
    index("idx_statement_emails_holder").on(
      t.holderType,
      t.holderId,
      t.sentAt,
    ),
    index("idx_statement_emails_line").on(t.lineId),
  ],
);
