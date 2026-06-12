CREATE TABLE "internal_debt_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text NOT NULL,
	"category_id" uuid,
	"expense_id" uuid,
	"bank_account_id" uuid,
	"journal_entry_id" uuid,
	"status" text DEFAULT 'posted' NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "ck_internal_debt_entries_amount_pos" CHECK ("internal_debt_entries"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "internal_debt_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"party_type" text DEFAULT 'owner' NOT NULL,
	"phone" text,
	"bank_name" text,
	"bank_account_number" text,
	"bank_account_holder_name" text,
	"notes" text,
	"total_outstanding" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ck_internal_debt_parties_outstanding_nonneg" CHECK ("internal_debt_parties"."total_outstanding" >= 0)
);
--> statement-breakpoint
CREATE TABLE "internal_debt_repayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount" bigint NOT NULL,
	"description" text,
	"journal_entry_id" uuid,
	"status" text DEFAULT 'posted' NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "ck_internal_debt_repay_amount_pos" CHECK ("internal_debt_repayments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "internal_debt_entries" ADD CONSTRAINT "internal_debt_entries_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_entries" ADD CONSTRAINT "internal_debt_entries_party_id_internal_debt_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."internal_debt_parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_entries" ADD CONSTRAINT "internal_debt_entries_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_entries" ADD CONSTRAINT "internal_debt_entries_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_entries" ADD CONSTRAINT "internal_debt_entries_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_entries" ADD CONSTRAINT "internal_debt_entries_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_entries" ADD CONSTRAINT "internal_debt_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_parties" ADD CONSTRAINT "internal_debt_parties_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_parties" ADD CONSTRAINT "internal_debt_parties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_parties" ADD CONSTRAINT "internal_debt_parties_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_repayments" ADD CONSTRAINT "internal_debt_repayments_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_repayments" ADD CONSTRAINT "internal_debt_repayments_party_id_internal_debt_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."internal_debt_parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_repayments" ADD CONSTRAINT "internal_debt_repayments_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_repayments" ADD CONSTRAINT "internal_debt_repayments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_repayments" ADD CONSTRAINT "internal_debt_repayments_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_debt_repayments" ADD CONSTRAINT "internal_debt_repayments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_internal_debt_entries_party" ON "internal_debt_entries" USING btree ("party_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_internal_debt_entries_outlet_date" ON "internal_debt_entries" USING btree ("outlet_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_internal_debt_parties_outlet" ON "internal_debt_parties" USING btree ("outlet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_internal_debt_parties_outlet_name" ON "internal_debt_parties" USING btree ("outlet_id","name") WHERE "internal_debt_parties"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_internal_debt_repay_party" ON "internal_debt_repayments" USING btree ("party_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_internal_debt_repay_outlet_date" ON "internal_debt_repayments" USING btree ("outlet_id","occurred_at");