CREATE TABLE "pos_daily_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"gross_total" bigint DEFAULT 0 NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"cogs_total" bigint DEFAULT 0 NOT NULL,
	"recompute_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_pos_daily_journals_nonneg" CHECK ("pos_daily_journals"."transaction_count" >= 0 AND "pos_daily_journals"."gross_total" >= 0 AND "pos_daily_journals"."discount_total" >= 0 AND "pos_daily_journals"."cogs_total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos_daily_journals" ADD CONSTRAINT "pos_daily_journals_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_pos_daily_journals_outlet_date_kind" ON "pos_daily_journals" USING btree ("outlet_id","entry_date","kind");--> statement-breakpoint
CREATE INDEX "idx_pos_daily_journals_status" ON "pos_daily_journals" USING btree ("status","entry_date");