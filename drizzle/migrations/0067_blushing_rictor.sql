CREATE TABLE "cogs_period_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"period_ym" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid NOT NULL,
	"total_cogs" bigint NOT NULL,
	"totals_by_section_json" text NOT NULL,
	"adjustment_total" bigint DEFAULT 0 NOT NULL,
	"adjustment_journal_entry_id" uuid,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "cogs_period_closes" ADD CONSTRAINT "cogs_period_closes_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cogs_period_closes" ADD CONSTRAINT "cogs_period_closes_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_cogs_period_closes_outlet_ym" ON "cogs_period_closes" USING btree ("outlet_id","period_ym");--> statement-breakpoint
CREATE INDEX "idx_cogs_period_closes_outlet_date" ON "cogs_period_closes" USING btree ("outlet_id","closed_at");