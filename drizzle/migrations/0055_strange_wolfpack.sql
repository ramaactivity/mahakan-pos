CREATE TABLE "investors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"nickname" text,
	"nik" text,
	"email" text,
	"phone" text,
	"address" text,
	"date_of_birth" date,
	"occupation" text,
	"ig_handle" text,
	"bank_name" text,
	"bank_account_number" text,
	"bank_account_holder_name" text,
	"modal_disetor" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"exited_at" timestamp with time zone,
	"exit_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ck_investors_modal_nonneg" CHECK ("investors"."modal_disetor" >= 0),
	CONSTRAINT "ck_investors_exit_consistency" CHECK (("investors"."status" = 'exited' AND "investors"."exited_at" IS NOT NULL)
        OR ("investors"."status" != 'exited'))
);
--> statement-breakpoint
CREATE TABLE "pengelola" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"nickname" text,
	"nik" text,
	"email" text,
	"phone" text,
	"address" text,
	"date_of_birth" date,
	"bank_name" text,
	"bank_account_number" text,
	"bank_account_holder_name" text,
	"modal_disetor" bigint DEFAULT 0 NOT NULL,
	"user_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"exited_at" timestamp with time zone,
	"exit_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ck_pengelola_modal_nonneg" CHECK ("pengelola"."modal_disetor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "capital_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"holder_type" text NOT NULL,
	"holder_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text,
	"journal_entry_id" uuid,
	"distribution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ck_capital_movements_amount_nonzero" CHECK ("capital_movements"."amount" != 0)
);
--> statement-breakpoint
CREATE TABLE "profit_distribution_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"distribution_id" uuid NOT NULL,
	"holder_type" text NOT NULL,
	"holder_id" uuid NOT NULL,
	"modal_disetor_snapshot" bigint NOT NULL,
	"share_pct" numeric(8, 4) NOT NULL,
	"amount_rupiah" bigint NOT NULL,
	"capital_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_dist_lines_amount_nonneg" CHECK ("profit_distribution_lines"."amount_rupiah" >= 0),
	CONSTRAINT "ck_dist_lines_share_pct_range" CHECK ("profit_distribution_lines"."share_pct"::numeric BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "profit_distributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"net_profit_snapshot" bigint NOT NULL,
	"bagi_hasil_pct" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"loss_pct" numeric(5, 2) DEFAULT '3.00' NOT NULL,
	"capex_pct" numeric(5, 2) DEFAULT '0.70' NOT NULL,
	"retained_pct" numeric(5, 2) DEFAULT '0.20' NOT NULL,
	"investor_pool_pct" numeric(5, 2) DEFAULT '35.00' NOT NULL,
	"pengelola_pool_pct" numeric(5, 2) DEFAULT '65.00' NOT NULL,
	"bagi_hasil_amount" bigint NOT NULL,
	"loss_amount" bigint NOT NULL,
	"capex_amount" bigint NOT NULL,
	"retained_amount" bigint NOT NULL,
	"investor_pool_amount" bigint NOT NULL,
	"pengelola_pool_amount" bigint NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"journal_entry_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "ck_distribution_month_range" CHECK ("profit_distributions"."period_month" BETWEEN 1 AND 12),
	CONSTRAINT "ck_distribution_year_range" CHECK ("profit_distributions"."period_year" BETWEEN 2020 AND 2100),
	CONSTRAINT "ck_distribution_pools_consistent" CHECK ("profit_distributions"."investor_pool_pct"::numeric + "profit_distributions"."pengelola_pool_pct"::numeric = 100.00)
);
--> statement-breakpoint
CREATE TABLE "investor_statement_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"distribution_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"holder_type" text NOT NULL,
	"holder_id" uuid NOT NULL,
	"to_email" text NOT NULL,
	"trigger" text NOT NULL,
	"message_id" text,
	"status" text NOT NULL,
	"error_message" text,
	"error_code" text,
	"sent_by" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investors" ADD CONSTRAINT "investors_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investors" ADD CONSTRAINT "investors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investors" ADD CONSTRAINT "investors_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pengelola" ADD CONSTRAINT "pengelola_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pengelola" ADD CONSTRAINT "pengelola_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pengelola" ADD CONSTRAINT "pengelola_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pengelola" ADD CONSTRAINT "pengelola_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_movements" ADD CONSTRAINT "capital_movements_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_movements" ADD CONSTRAINT "capital_movements_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_movements" ADD CONSTRAINT "capital_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profit_distribution_lines" ADD CONSTRAINT "profit_distribution_lines_distribution_id_profit_distributions_id_fk" FOREIGN KEY ("distribution_id") REFERENCES "public"."profit_distributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profit_distribution_lines" ADD CONSTRAINT "profit_distribution_lines_capital_movement_id_capital_movements_id_fk" FOREIGN KEY ("capital_movement_id") REFERENCES "public"."capital_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD CONSTRAINT "profit_distributions_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD CONSTRAINT "profit_distributions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD CONSTRAINT "profit_distributions_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD CONSTRAINT "profit_distributions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_statement_emails" ADD CONSTRAINT "investor_statement_emails_distribution_id_profit_distributions_id_fk" FOREIGN KEY ("distribution_id") REFERENCES "public"."profit_distributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_statement_emails" ADD CONSTRAINT "investor_statement_emails_line_id_profit_distribution_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."profit_distribution_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_statement_emails" ADD CONSTRAINT "investor_statement_emails_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_investors_outlet_status" ON "investors" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_investors_outlet_nik" ON "investors" USING btree ("outlet_id","nik") WHERE "investors"."nik" IS NOT NULL AND "investors"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_investors_outlet_email" ON "investors" USING btree ("outlet_id","email") WHERE "investors"."email" IS NOT NULL AND "investors"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_pengelola_outlet_status" ON "pengelola" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_pengelola_outlet_name" ON "pengelola" USING btree ("outlet_id","full_name") WHERE "pengelola"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_capital_movements_holder" ON "capital_movements" USING btree ("holder_type","holder_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_capital_movements_outlet_date" ON "capital_movements" USING btree ("outlet_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_capital_movements_distribution" ON "capital_movements" USING btree ("distribution_id");--> statement-breakpoint
CREATE INDEX "idx_dist_lines_distribution" ON "profit_distribution_lines" USING btree ("distribution_id");--> statement-breakpoint
CREATE INDEX "idx_dist_lines_holder" ON "profit_distribution_lines" USING btree ("holder_type","holder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_dist_lines_distribution_holder" ON "profit_distribution_lines" USING btree ("distribution_id","holder_type","holder_id");--> statement-breakpoint
CREATE INDEX "idx_distributions_outlet_period" ON "profit_distributions" USING btree ("outlet_id","period_year","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_distributions_active_per_period" ON "profit_distributions" USING btree ("outlet_id","period_year","period_month") WHERE status IN ('approved', 'posted');--> statement-breakpoint
CREATE INDEX "idx_statement_emails_distribution" ON "investor_statement_emails" USING btree ("distribution_id","sent_at");--> statement-breakpoint
CREATE INDEX "idx_statement_emails_holder" ON "investor_statement_emails" USING btree ("holder_type","holder_id","sent_at");--> statement-breakpoint
CREATE INDEX "idx_statement_emails_line" ON "investor_statement_emails" USING btree ("line_id");