CREATE TABLE "cash_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"deposit_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"bank_destination" text NOT NULL,
	"reference_no" text,
	"photo_url" text,
	"notes" text,
	"status" text DEFAULT 'pending_verification' NOT NULL,
	"covers_from_date" date NOT NULL,
	"covers_to_date" date NOT NULL,
	"deposited_by" uuid NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"rejected_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_cash_deposits_amount_pos" CHECK ("cash_deposits"."amount" > 0),
	CONSTRAINT "ck_cash_deposits_covers_range" CHECK ("cash_deposits"."covers_to_date" >= "cash_deposits"."covers_from_date"),
	CONSTRAINT "ck_cash_deposits_verified_consistency" CHECK (("cash_deposits"."status" = 'verified' AND "cash_deposits"."verified_by" IS NOT NULL AND "cash_deposits"."verified_at" IS NOT NULL)
        OR ("cash_deposits"."status" = 'rejected' AND "cash_deposits"."rejected_reason" IS NOT NULL)
        OR ("cash_deposits"."status" = 'pending_verification' AND "cash_deposits"."verified_by" IS NULL AND "cash_deposits"."verified_at" IS NULL AND "cash_deposits"."rejected_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "aggregator_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"gross_amount" bigint NOT NULL,
	"fee_amount" bigint DEFAULT 0 NOT NULL,
	"net_amount" bigint NOT NULL,
	"bank_credited_at" timestamp with time zone,
	"reference_no" text,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_aggregator_settlements_period_range" CHECK ("aggregator_settlements"."period_to" >= "aggregator_settlements"."period_from"),
	CONSTRAINT "ck_aggregator_settlements_gross_nonneg" CHECK ("aggregator_settlements"."gross_amount" >= 0),
	CONSTRAINT "ck_aggregator_settlements_fee_nonneg" CHECK ("aggregator_settlements"."fee_amount" >= 0),
	CONSTRAINT "ck_aggregator_settlements_net_consistency" CHECK ("aggregator_settlements"."net_amount" = "aggregator_settlements"."gross_amount" - "aggregator_settlements"."fee_amount")
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "source_type" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "payroll_period_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_deposits" ADD CONSTRAINT "cash_deposits_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_deposits" ADD CONSTRAINT "cash_deposits_deposited_by_users_id_fk" FOREIGN KEY ("deposited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_deposits" ADD CONSTRAINT "cash_deposits_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aggregator_settlements" ADD CONSTRAINT "aggregator_settlements_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aggregator_settlements" ADD CONSTRAINT "aggregator_settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cash_deposits_outlet_status_date" ON "cash_deposits" USING btree ("outlet_id","status","deposit_date");--> statement-breakpoint
CREATE INDEX "idx_cash_deposits_outlet_depositor" ON "cash_deposits" USING btree ("outlet_id","deposited_by");--> statement-breakpoint
CREATE INDEX "idx_aggregator_settlements_outlet_channel_period" ON "aggregator_settlements" USING btree ("outlet_id","channel","period_from");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_expenses_source" ON "expenses" USING btree ("source_type","outlet_id","expense_date");--> statement-breakpoint
-- Backfill source_type for existing rows (sesi Q Q1)
UPDATE "expenses" SET "source_type" = 'refund' WHERE "refunded_transaction_id" IS NOT NULL;--> statement-breakpoint
UPDATE "expenses" SET "source_type" = 'purchase', "purchase_id" = p."id"
  FROM "purchases" p WHERE p."expense_id" = "expenses"."id" AND "expenses"."source_type" = 'manual';