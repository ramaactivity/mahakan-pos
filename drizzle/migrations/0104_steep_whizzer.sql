CREATE TABLE "daily_market_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"entry_date" date NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount" bigint NOT NULL,
	"description" text NOT NULL,
	"courier_name" text,
	"bank_account_id" uuid,
	"category_id" uuid,
	"receipt_image_url" text,
	"status" text DEFAULT 'posted' NOT NULL,
	"journal_entry_id" uuid,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	CONSTRAINT "ck_daily_market_amount_pos" CHECK ("daily_market_entries"."amount" > 0),
	CONSTRAINT "ck_daily_market_shape" CHECK (("daily_market_entries"."kind" = 'topup' AND "daily_market_entries"."bank_account_id" IS NOT NULL)
        OR ("daily_market_entries"."kind" = 'spend' AND "daily_market_entries"."category_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "daily_market_entries" ADD CONSTRAINT "daily_market_entries_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_market_entries" ADD CONSTRAINT "daily_market_entries_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_market_entries" ADD CONSTRAINT "daily_market_entries_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_market_entries" ADD CONSTRAINT "daily_market_entries_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_market_entries" ADD CONSTRAINT "daily_market_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_daily_market_outlet_date" ON "daily_market_entries" USING btree ("outlet_id","entry_date");--> statement-breakpoint
CREATE INDEX "idx_daily_market_outlet_kind" ON "daily_market_entries" USING btree ("outlet_id","kind");