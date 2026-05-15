CREATE TABLE "historical_daily_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"gross_revenue" bigint DEFAULT 0 NOT NULL,
	"total_refund" bigint DEFAULT 0 NOT NULL,
	"total_void" bigint DEFAULT 0 NOT NULL,
	"total_discount" bigint DEFAULT 0 NOT NULL,
	"net_revenue" bigint DEFAULT 0 NOT NULL,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"cogs" bigint DEFAULT 0 NOT NULL,
	"cash_in" bigint DEFAULT 0 NOT NULL,
	"qris_in" bigint DEFAULT 0 NOT NULL,
	"edc_in" bigint DEFAULT 0 NOT NULL,
	"aggregator_in" bigint DEFAULT 0 NOT NULL,
	"source_label" text,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_hist_daily_summary_outlet_date" UNIQUE("outlet_id","business_date"),
	CONSTRAINT "ck_hist_daily_summary_nonneg" CHECK ("historical_daily_summary"."gross_revenue" >= 0
        AND "historical_daily_summary"."total_refund" >= 0
        AND "historical_daily_summary"."total_void" >= 0
        AND "historical_daily_summary"."total_discount" >= 0
        AND "historical_daily_summary"."net_revenue" >= 0
        AND "historical_daily_summary"."transaction_count" >= 0
        AND "historical_daily_summary"."cogs" >= 0)
);
--> statement-breakpoint
CREATE TABLE "historical_expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"category_id" uuid,
	"category_label_legacy" text,
	"amount" bigint NOT NULL,
	"description" text,
	"source_label" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_hist_expense_amount_pos" CHECK ("historical_expense"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "historical_daily_summary" ADD CONSTRAINT "historical_daily_summary_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_daily_summary" ADD CONSTRAINT "historical_daily_summary_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_expense" ADD CONSTRAINT "historical_expense_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_expense" ADD CONSTRAINT "historical_expense_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_expense" ADD CONSTRAINT "historical_expense_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hist_daily_summary_outlet_date" ON "historical_daily_summary" USING btree ("outlet_id","business_date");--> statement-breakpoint
CREATE INDEX "idx_hist_expense_outlet_date" ON "historical_expense" USING btree ("outlet_id","business_date");--> statement-breakpoint
CREATE INDEX "idx_hist_expense_category" ON "historical_expense" USING btree ("category_id");