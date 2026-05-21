CREATE TABLE "creditors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"nickname" text,
	"nik" text,
	"email" text,
	"phone" text,
	"address" text,
	"bank_name" text,
	"bank_account_number" text,
	"bank_account_holder_name" text,
	"principal_original" bigint NOT NULL,
	"principal_outstanding" bigint DEFAULT 0 NOT NULL,
	"interest_rate_pct" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"interest_period" text DEFAULT 'monthly' NOT NULL,
	"start_date" date NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ck_creditors_principal_original_nonneg" CHECK ("creditors"."principal_original" >= 0),
	CONSTRAINT "ck_creditors_principal_outstanding_nonneg" CHECK ("creditors"."principal_outstanding" >= 0),
	CONSTRAINT "ck_creditors_principal_outstanding_lte_original" CHECK ("creditors"."principal_outstanding" <= "creditors"."principal_original"),
	CONSTRAINT "ck_creditors_interest_rate_range" CHECK ("creditors"."interest_rate_pct"::numeric BETWEEN 0 AND 100),
	CONSTRAINT "ck_creditors_due_after_start" CHECK ("creditors"."due_date" IS NULL OR "creditors"."due_date" >= "creditors"."start_date")
);
--> statement-breakpoint
CREATE TABLE "creditor_repayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"creditor_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"principal_amount" bigint NOT NULL,
	"interest_amount" bigint DEFAULT 0 NOT NULL,
	"description" text,
	"journal_entry_id" uuid,
	"status" text DEFAULT 'posted' NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "ck_creditor_repay_principal_nonneg" CHECK ("creditor_repayments"."principal_amount" >= 0),
	CONSTRAINT "ck_creditor_repay_interest_nonneg" CHECK ("creditor_repayments"."interest_amount" >= 0),
	CONSTRAINT "ck_creditor_repay_total_positive" CHECK (("creditor_repayments"."principal_amount" + "creditor_repayments"."interest_amount") > 0)
);
--> statement-breakpoint
CREATE TABLE "share_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_investor_id" uuid,
	"to_investor_id" uuid,
	"share_pct_delta" numeric(7, 4) NOT NULL,
	"amount_idr" bigint DEFAULT 0 NOT NULL,
	"bank_account_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text,
	"journal_entry_id" uuid,
	"status" text DEFAULT 'posted' NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "ck_share_tx_delta_positive" CHECK ("share_transactions"."share_pct_delta"::numeric > 0),
	CONSTRAINT "ck_share_tx_delta_range" CHECK ("share_transactions"."share_pct_delta"::numeric <= 100),
	CONSTRAINT "ck_share_tx_amount_nonneg" CHECK ("share_transactions"."amount_idr" >= 0),
	CONSTRAINT "ck_share_tx_kind_shape" CHECK (
        ("share_transactions"."kind" = 'p2p_transfer'
          AND "share_transactions"."from_investor_id" IS NOT NULL
          AND "share_transactions"."to_investor_id" IS NOT NULL
          AND "share_transactions"."amount_idr" = 0
          AND "share_transactions"."bank_account_id" IS NULL)
        OR ("share_transactions"."kind" = 'company_buyback'
          AND "share_transactions"."from_investor_id" IS NOT NULL
          AND "share_transactions"."to_investor_id" IS NULL
          AND "share_transactions"."amount_idr" > 0
          AND "share_transactions"."bank_account_id" IS NOT NULL)
        OR ("share_transactions"."kind" IN ('top_up', 'initial')
          AND "share_transactions"."from_investor_id" IS NULL
          AND "share_transactions"."to_investor_id" IS NOT NULL
          AND "share_transactions"."amount_idr" > 0
          AND "share_transactions"."bank_account_id" IS NOT NULL)
      )
);
--> statement-breakpoint
CREATE TABLE "withdrawal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text,
	"journal_entry_id" uuid,
	"capital_movement_id" uuid,
	"status" text DEFAULT 'posted' NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "ck_withdrawal_min_amount" CHECK ("withdrawal_requests"."amount" >= 50000)
);
--> statement-breakpoint
ALTER TABLE "investors" ADD COLUMN "share_pct" numeric(7, 4) DEFAULT '0.0000' NOT NULL;--> statement-breakpoint
ALTER TABLE "investors" ADD COLUMN "dividend_balance" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pengelola" ADD COLUMN "dividend_balance" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "capital_movements" ADD COLUMN "parent_movement_id" uuid;--> statement-breakpoint
ALTER TABLE "capital_movements" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "capital_movements" ADD COLUMN "reversed_by" uuid;--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD COLUMN "calculation_model" text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD COLUMN "payout_ratio_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD COLUMN "loss_rate_snapshot" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD COLUMN "capex_rate_snapshot" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD COLUMN "reversed_by" uuid;--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD COLUMN "reversal_reason" text;--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD COLUMN "reversed_distribution_id" uuid;--> statement-breakpoint
ALTER TABLE "creditors" ADD CONSTRAINT "creditors_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditors" ADD CONSTRAINT "creditors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditors" ADD CONSTRAINT "creditors_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD CONSTRAINT "creditor_repayments_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD CONSTRAINT "creditor_repayments_creditor_id_creditors_id_fk" FOREIGN KEY ("creditor_id") REFERENCES "public"."creditors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD CONSTRAINT "creditor_repayments_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD CONSTRAINT "creditor_repayments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD CONSTRAINT "creditor_repayments_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD CONSTRAINT "creditor_repayments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_transactions" ADD CONSTRAINT "share_transactions_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_transactions" ADD CONSTRAINT "share_transactions_from_investor_id_investors_id_fk" FOREIGN KEY ("from_investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_transactions" ADD CONSTRAINT "share_transactions_to_investor_id_investors_id_fk" FOREIGN KEY ("to_investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_transactions" ADD CONSTRAINT "share_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_transactions" ADD CONSTRAINT "share_transactions_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_transactions" ADD CONSTRAINT "share_transactions_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_transactions" ADD CONSTRAINT "share_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_capital_movement_id_capital_movements_id_fk" FOREIGN KEY ("capital_movement_id") REFERENCES "public"."capital_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_creditors_outlet_status" ON "creditors" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_creditors_outlet_nik" ON "creditors" USING btree ("outlet_id","nik") WHERE "creditors"."nik" IS NOT NULL AND "creditors"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_creditor_repay_creditor" ON "creditor_repayments" USING btree ("creditor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_creditor_repay_outlet_date" ON "creditor_repayments" USING btree ("outlet_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_share_tx_outlet_date" ON "share_transactions" USING btree ("outlet_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_share_tx_from" ON "share_transactions" USING btree ("from_investor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_share_tx_to" ON "share_transactions" USING btree ("to_investor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_withdrawal_outlet_date" ON "withdrawal_requests" USING btree ("outlet_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_withdrawal_investor" ON "withdrawal_requests" USING btree ("investor_id","occurred_at");--> statement-breakpoint
ALTER TABLE "capital_movements" ADD CONSTRAINT "capital_movements_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD CONSTRAINT "profit_distributions_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_investors_outlet_share" ON "investors" USING btree ("outlet_id","share_pct");--> statement-breakpoint
CREATE INDEX "idx_cm_parent" ON "capital_movements" USING btree ("parent_movement_id");--> statement-breakpoint
ALTER TABLE "investors" ADD CONSTRAINT "ck_investors_share_pct_range" CHECK ("investors"."share_pct"::numeric BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "investors" ADD CONSTRAINT "ck_investors_dividend_balance_nonneg" CHECK ("investors"."dividend_balance" >= 0);--> statement-breakpoint
ALTER TABLE "pengelola" ADD CONSTRAINT "ck_pengelola_dividend_balance_nonneg" CHECK ("pengelola"."dividend_balance" >= 0);--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD CONSTRAINT "ck_distribution_v2_fields_consistent" CHECK ("profit_distributions"."calculation_model" = 'v1' OR ("profit_distributions"."payout_ratio_pct" IS NOT NULL AND "profit_distributions"."loss_rate_snapshot" IS NOT NULL AND "profit_distributions"."capex_rate_snapshot" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD CONSTRAINT "ck_distribution_payout_ratio_range" CHECK ("profit_distributions"."payout_ratio_pct" IS NULL OR "profit_distributions"."payout_ratio_pct"::numeric BETWEEN 0 AND 100);